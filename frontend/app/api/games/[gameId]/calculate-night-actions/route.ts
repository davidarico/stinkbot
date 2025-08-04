import { NextRequest, NextResponse } from "next/server";
import { OpenAI } from "openai";
import fs from "fs/promises";
import path from "path";
import { db } from "@/lib/database";

// Define the tool schema for function calling
const tools = {
  type: "function" as const,
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
};

async function getGameData(gameId: string, nightNumber: number) {
  try {
    // Get game information
    const game = await db.getGame(gameId);
    if (!game) {
      throw new Error(`Game ${gameId} not found`);
    }

    // Get all players with their roles and framing information
    const players = await db.getPlayers(gameId);
    
    // Get all roles in the game
    const gameRoles = await db.getGameRoles(gameId);
    const allRoles = await db.getRoles();
    
    // Create a map of role IDs to role information
    const roleMap = new Map();
    allRoles.forEach(role => {
      roleMap.set(role.id, role);
    });

    // Get night actions for this night
    const nightActions = await db.getNightActions(gameId, nightNumber);
    const actionMap = new Map();
    nightActions.forEach(action => {
      actionMap.set(action.player_id, action.action);
    });

    // Process players with proper framing logic
    const processedPlayers = players.map(player => {
      const role = player.role_id ? roleMap.get(player.role_id) : null;
      const actionNotes = actionMap.get(player.id) || "";
      
      // Fix framing logic: player is only framed if frame night was current night or previous night
      const isCurrentlyFramed = player.framed_night && 
        (player.framed_night === nightNumber || player.framed_night === nightNumber - 1);

      return {
        id: player.id,
        username: player.username,
        status: player.is_dead ? "dead" : "alive",
        role: role?.name || "Unknown",
        team: role?.alignment || "unknown",
        isWolf: player.is_wolf,
        isFramed: isCurrentlyFramed,
        framedNight: player.framed_night,
        chargesLeft: player.charges,
        actionNotes: actionNotes,
        // Include all relevant role properties for AI processing
        roleDescription: role?.description || "",
        roleTargets: role?.targets || "",
        roleMoves: role?.moves || false,
        roleStandardResultsFlavor: role?.standardResultsFlavor || "",
        roleImmunities: role?.immunities || "",
        roleSpecialProperties: role?.specialProperties || "",
        roleFramerInteraction: role?.framerInteraction || "",
        roleHasCharges: role?.hasCharges || false,
        roleDefaultCharges: role?.defaultCharges || 0,
        roleInWolfChat: role?.inWolfChat || false,
        roleIsSpotlight: role?.isSpotlight || false
      };
    });

    // Get all roles that are in this game with their full information
    const gameRoleInfo = gameRoles.map(gameRole => {
      const role = roleMap.get(gameRole.role_id);
      return {
        name: role?.name || "Unknown",
        team: role?.alignment || "unknown",
        description: role?.description || "",
        targets: role?.targets || "",
        moves: role?.moves || false,
        standardResultsFlavor: role?.standardResultsFlavor || "",
        immunities: role?.immunities || "",
        specialProperties: role?.specialProperties || "",
        framerInteraction: role?.framerInteraction || "",
        hasCharges: role?.hasCharges || false,
        defaultCharges: role?.defaultCharges || 0,
        inWolfChat: role?.inWolfChat || false,
        isSpotlight: role?.isSpotlight || false,
        // Game-specific role info
        roleCount: gameRole.role_count,
        customName: gameRole.custom_name,
        charges: gameRole.charges
      };
    });

    return {
      game: {
        id: game.id,
        dayNumber: game.day_number,
        nightNumber: nightNumber,
        status: game.status,
        dayPhase: game.day_phase
      },
      players: processedPlayers,
      roles: gameRoleInfo
    };
  } catch (error) {
    console.error('Error getting game data:', error);
    throw error;
  }
}

export async function POST(req: NextRequest, { params }: { params: { gameId: string } }) {
  const { gameId } = params;
  const { nightNumber } = await req.json();

  if (!nightNumber) {
    return NextResponse.json({ error: "Night number is required" }, { status: 400 });
  }

  try {
    // 1. Get game data with real database queries
    const gameData = await getGameData(gameId, nightNumber);

    // 2. Read the prompt template
    const promptPath = path.join(process.cwd(), "NIGHT_ACTION_PROMPT.txt");
    const promptTemplate = await fs.readFile(promptPath, "utf8");

    // 3. Format roles with all relevant information for the prompt
    const rolesText = gameData.roles
      .map((role: any) => {
        let roleText = `- ${role.name} (${role.team}): ${role.description}`;
        
        // Add special properties if they exist
        if (role.specialProperties) {
          roleText += `\n  Special Properties: ${role.specialProperties}`;
        }
        
        // Add immunities if they exist
        if (role.immunities) {
          roleText += `\n  Immunities: ${role.immunities}`;
        }
        
        // Add framer interaction if it exists
        if (role.framerInteraction) {
          roleText += `\n  Framer Interaction: ${role.framerInteraction}`;
        }
        
        // Add charges information if applicable
        if (role.hasCharges) {
          roleText += `\n  Has Charges: ${role.defaultCharges} default charges`;
        }
        
        // Add movement information
        if (role.moves) {
          roleText += `\n  Can Move: Yes`;
        }
        
        // Add targeting information
        if (role.targets) {
          roleText += `\n  Targets: ${role.targets}`;
        }
        
        return roleText;
      })
      .join("\n\n");

    // 4. Format players with comprehensive information
    const playersText = gameData.players
      .map((p: any) => {
        let playerText = `- ${p.username} (${p.status})`;
        
        // Add framing information
        if (p.isFramed) {
          playerText += ` [framed:${!!p.isFramed}]`;
        }
        
        // Add role information
        playerText += `: Role=${p.role} (${p.team})`;
        
        // Add wolf status
        if (p.isWolf) {
          playerText += `, Wolf Team`;
        }
        
        // Add charges if applicable
        if (p.roleHasCharges && p.chargesLeft !== null) {
          playerText += `, Charges Left: ${p.chargesLeft}`;
        }
        
        // Add action notes
        if (p.actionNotes) {
          playerText += `, Action="${p.actionNotes}"`;
        }
        
        return playerText;
      })
      .join("\n");

    // 5. Fill in the prompt
    const prompt = promptTemplate
      .replace("{roles}", rolesText)
      .replace("{players}", playersText);

    // 6. Call OpenAI with function calling
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    
    try {
      const completion = await openai.chat.completions.create({
        model: "o4-mini-2025-04-16",
        messages: [
          { role: "system", content: "You are the Werewolf moderator. Process the night actions according to the rules and return the results using the provided function." },
          { role: "user", content: prompt }
        ],
        tools: [tools]
      });

      // 7. Parse the function call response
      const message = completion.choices[0].message;
      
      if (message.tool_calls?.length) {
        const call = message.tool_calls[0];
        const result = JSON.parse(call.function.arguments);
        
        // Transform the result to match the expected frontend format
        return NextResponse.json({
          deaths: result.deaths || [],
          results: result.results || [],
          explanation: result.explanation || ""
        });
      } else {
        // Fallback: try to parse JSON from content if function call failed
        const content = message.content || "";
        const jsonStart = content.indexOf("{");
        const jsonEnd = content.lastIndexOf("}");
        
        if (jsonStart !== -1 && jsonEnd !== -1) {
          const jsonStr = content.slice(jsonStart, jsonEnd + 1);
          const result = JSON.parse(jsonStr);
          
          return NextResponse.json({
            deaths: result.deaths || [],
            results: result.results || [],
            explanation: result.explanation || ""
          });
        } else {
          throw new Error("No valid response format received from AI");
        }
      }
    } catch (e) {
      return NextResponse.json({ error: "OpenAI API error", details: String(e) }, { status: 500 });
    }
  } catch (error) {
    console.error('Error in calculate night actions:', error);
    return NextResponse.json({ error: "Failed to calculate night actions", details: String(error) }, { status: 500 });
  }
}