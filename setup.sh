#!/bin/bash

# Werewolf Bot Quick Setup Script

echo "🐺 Werewolf Discord Bot Setup"
echo "================================"

# Check if .env exists
if [ ! -f .env ]; then
    echo "📝 Creating .env file from template..."
    cp .env.example .env
    echo "✅ .env file created!"
    echo "⚠️  Please edit .env with your Discord bot token and database credentials"
else
    echo "✅ .env file already exists"
fi

# Check Node.js dependencies
if [ ! -d node_modules ]; then
    echo "📦 Installing Node.js dependencies..."
    npm install
    echo "✅ Dependencies installed!"
else
    echo "✅ Dependencies already installed"
fi

echo ""
echo "🔧 Next Steps:"
echo "1. Edit .env with your Discord token and database credentials"
echo "2. Create a PostgreSQL database named 'werewolf_bot'"
echo "3. Run: psql -d werewolf_bot -f database_setup.sql"
echo "4. Test your setup: npm test"
echo "5. Start the bot: npm start"
echo ""
echo "📚 See README.md for detailed instructions"
