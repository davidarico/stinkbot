import { NextRequest, NextResponse } from "next/server";
import { OpenAI } from "openai";
import fs from "fs/promises";
import path from "path";
import { db } from "@/lib/database";

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
    const promptPath = path.join(process.cwd(), "frontend", "NIGHT_ACTION_PROMPT.txt");
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
          playerText += ` [framed night ${p.framedNight}]`;
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

    // 5. Add JSON output instructions
    const jsonInstructions = `\nRespond ONLY in the following JSON format:\n{\n  "deaths": [ { "player": "Name", "cause": "string" } ],\n  "infoResults": [ { "player": "Name", "result": "string" } ],\n  "otherEvents": [ "string", ... ]\n}\nDo not include any text outside the JSON.\n`;

    // 6. Fill in the prompt
    const prompt = promptTemplate
      .replace("{roles}", rolesText)
      .replace("{players}", playersText)
      + "\n" + jsonInstructions;

    // 7. Call OpenAI
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    let aiText = "";
    try {
      const completion = await openai.chat.completions.create({
        model: "gpt-4o",
        messages: [{ role: "user", content: prompt }],
        temperature: 0.2,
        max_tokens: 800,
      });
      aiText = completion.choices[0].message.content?.trim() || "";
    } catch (e) {
      return NextResponse.json({ error: "OpenAI API error", details: String(e) }, { status: 500 });
    }

    // 8. Parse and return the JSON result
    let result;
    try {
      const jsonStart = aiText.indexOf("{");
      const jsonEnd = aiText.lastIndexOf("}");
      result = JSON.parse(aiText.slice(jsonStart, jsonEnd + 1));
    } catch (e) {
      return NextResponse.json({ error: "Failed to parse AI response", aiText }, { status: 500 });
    }

    return NextResponse.json(result);
  } catch (error) {
    console.error('Error in calculate night actions:', error);
    return NextResponse.json({ error: "Failed to calculate night actions", details: String(error) }, { status: 500 });
  }
}