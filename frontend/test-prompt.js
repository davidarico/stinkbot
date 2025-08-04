require('dotenv').config();
const { Pool } = require('pg');
const { OpenAI } = require('openai');
const fs = require('fs/promises');
const path = require('path');

// Database configuration
const DATABASE_URL = process.env.DATABASE_URL || 'postgresql://localhost:5432/stinkbot';

// Simple test configuration - just set players with minimal info
const TEST_CONFIG = {
  nightNumber: 3,
  players: [
    {
      username: "Stinky",
      roleId: 176, // Aurasmith
      framedNight: 2,
      actionNotes: null
    },
    {
      username: "SCM", 
      roleId: 158, // Alpha
      framedNight: null,
      actionNotes: "Stinky"
    },
    {
      username: "Legs",
      roleId: 143, // Doctor
      framedNight: null,
      actionNotes: "Scherbie"
    },
    {
      username: "Scherbie",
      roleId: 141, // Bartender
      framedNight: null,
      actionNotes: "Stinky"
    },
    {
      username: "Austin",
      roleId: 169, // Arsonist
      framedNight: null,
      actionNotes: "SCM"
    },
    {
      username: "Rice",
      roleId: 157, // Villager
      framedNight: null,
      actionNotes: "Aurasmith charge on Stinky"
    }
  ]
};

const tools = {
  type: "function",
  function: {
    name: "process_night_actions",
    description: "Apply the Werewolf night-action rules and return structured results",
    parameters: {
      type: "object",
      properties: {
        deaths: {
          type: "array",
          items: {
            type: "object",
            properties: {
              player: { type: "string" },
              cause:  { type: "string" }
            },
            required: ["player", "cause"]
          }
        },
        results: {
          type: "array",
          items: {
            type: "object",
            properties: {
              player: { type: "string" },
              resultMessage: { type: "string" }
            },
            required: ["player", "resultMessage"]
          }
        }
      },
      required: ["deaths", "results"]
    }
  }
}

class SimplePromptTester {
  constructor() {
    this.pool = new Pool({
      connectionString: DATABASE_URL,
      ssl: DATABASE_URL.includes('supabase') ? { rejectUnauthorized: false } : false,
    });
    
    // Check if OpenAI API key is loaded
    if (!process.env.OPENAI_API_KEY) {
      console.error('❌ OPENAI_API_KEY not found in environment variables');
      console.log('Make sure you have a .env file with OPENAI_API_KEY=your_key_here');
      process.exit(1);
    }
    console.log('✅ OpenAI API key loaded successfully');
    
    this.openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  }

  async getRoleData(roleIds) {
    try {
      const result = await this.pool.query(
        `SELECT id, name, team, description, targets, moves, 
         standard_results_flavor, immunities, special_properties, framer_interaction
         FROM roles 
         WHERE id = ANY($1)
         ORDER BY id`,
        [roleIds]
      );
      return result.rows;
    } catch (error) {
      console.error('Error fetching role data:', error);
      throw error;
    }
  }

  async testPrompt() {
    console.log('=== PROMPT TEST ===');
    console.log('Night Number:', TEST_CONFIG.nightNumber);
    console.log('Players:', TEST_CONFIG.players.length);
    
    try {
      // 1. Get unique role IDs from players
      const roleIds = [...new Set(TEST_CONFIG.players.map(p => p.roleId))];
      console.log('Role IDs:', roleIds);

      // 2. Get role data from database
      const roles = await this.getRoleData(roleIds);
      console.log('Found roles:', roles.length);

      // 3. Create role map for quick lookup
      const roleMap = new Map();
      roles.forEach(role => {
        roleMap.set(role.id, role);
      });

      // 4. Read the prompt template
      const promptPath = path.join(process.cwd(), "NIGHT_ACTION_PROMPT.txt");
      const promptTemplate = await fs.readFile(promptPath, "utf8");

      // 5. Format roles for the prompt
      const rolesText = roles
        .map((role) => {
          let roleText = `- ${role.name} (${role.team}): ${role.description}`;
          
          if (role.special_properties) {
            roleText += `\n  Special Properties: ${role.special_properties}`;
          }
          
          if (role.immunities) {
            roleText += `\n  Immunities: ${role.immunities}`;
          }
          
          if (role.framer_interaction) {
            roleText += `\n  Framer Interaction: ${role.framer_interaction}`;
          }
          
          if (role.moves) {
            roleText += `\n  Can Move: Yes`;
          }
          else {
            roleText += `\n  Can Move: No`;
          }
          
          if (role.targets) {
            roleText += `\n  Targets: ${role.targets}`;
          }
          
          return roleText;
        })
        .join("\n\n");

      // 6. Format players for the prompt
      const playersText = TEST_CONFIG.players
        .map((p) => {
          const role = roleMap.get(p.roleId);
          if (!role) {
            console.error(`Role ID ${p.roleId} not found in database`);
            return null;
          }

          // Calculate if player is currently framed
          const isCurrentlyFramed = p.framedNight && 
            (p.framedNight === TEST_CONFIG.nightNumber || p.framedNight === TEST_CONFIG.nightNumber - 1);

          let playerText = `- ${p.username} (alive)`;
          
          // Add framing information
          playerText += ` [framed:${!!isCurrentlyFramed}]`;
          
          // Add role information
          playerText += `: Role=${role.name} (${role.team})`;
          
          // Add wolf status
          if (role.team === 'wolf') {
            playerText += `, Wolf Team`;
          }
          
          // Add action notes
          if (p.actionNotes) {
            playerText += `, Action="${p.actionNotes}"`;
          }
          
          return playerText;
        })
        .filter(text => text !== null) // Remove any null entries
        .join("\n");

      // 8. Fill in the prompt
      const prompt = promptTemplate
        .replace("{roles}", rolesText)
        .replace("{players}", playersText); 

      console.log('\n=== GENERATED PROMPT ===');
      console.log(prompt);

      // 2. Call the API using `tools` and let it pick the tool automatically:
      const completion = await this.openai.chat.completions.create({
        model: "o4-mini-2025-04-16",
        messages: [
          { role: "system", content: "You are the Werewolf moderator…" },
          { role: "user",   content: prompt }
        ],
        tools: [tools]
      });

      // 3. Parse out the tool call from the response:
      const message = completion.choices[0].message;
      console.log("Full message:", JSON.stringify(message, null, 2));
      
      if (message.tool_calls?.length) {
        const call = message.tool_calls[0];
        
                 try {
           const result = JSON.parse(call.function.arguments);
           console.log("deaths:",        result.deaths);
           console.log("results:",       result.results);
         } catch (parseError) {
          console.error("Failed to parse arguments:", parseError);
          console.error("Raw arguments:", call.function.arguments);
        }
      } else {
        console.error("No tool call returned:", message);
      }
      
    } catch (error) {
      console.error('Error testing prompt:', error);
    } finally {
      await this.pool.end();
    }
  }
}

// Run the test
if (require.main === module) {
  const tester = new SimplePromptTester();
  tester.testPrompt().catch(console.error);
}

module.exports = { SimplePromptTester, TEST_CONFIG }; 