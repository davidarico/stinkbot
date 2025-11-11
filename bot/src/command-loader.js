const fs = require('fs');
const path = require('path');

/**
 * Loads all command files from the commands directory
 * @param {string} commandsDir - Path to commands directory
 * @returns {Map<string, Object>} Map of command name to command module
 */
function loadCommands(commandsDir) {
    const commands = new Map();

    // Get all subdirectories in commands folder
    const categories = fs.readdirSync(commandsDir, { withFileTypes: true })
        .filter(dirent => dirent.isDirectory())
        .map(dirent => dirent.name);

    // Load commands from each category
    for (const category of categories) {
        const categoryPath = path.join(commandsDir, category);
        const commandFiles = fs.readdirSync(categoryPath)
            .filter(file => file.endsWith('.js'));

        for (const file of commandFiles) {
            const filePath = path.join(categoryPath, file);
            try {
                const command = require(filePath);

                // Validate command structure
                if (!command.name || typeof command.execute !== 'function') {
                    console.warn(`⚠️  Command at ${filePath} is missing required "name" or "execute" properties`);
                    continue;
                }

                // Store command with its name as key
                commands.set(command.name, command);

                // Also store aliases if they exist
                if (command.aliases && Array.isArray(command.aliases)) {
                    for (const alias of command.aliases) {
                        commands.set(alias, command);
                    }
                }

                console.log(`✓ Loaded command: ${command.name} (${category})`);
            } catch (error) {
                console.error(`✗ Failed to load command at ${filePath}:`, error);
            }
        }
    }

    console.log(`\n📦 Loaded ${commands.size} commands total\n`);
    return commands;
}

module.exports = { loadCommands };
