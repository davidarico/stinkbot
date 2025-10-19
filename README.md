# 🐺 StinkBot Monorepo

A monorepo containing the StinkBot Discord bot, frontend web application, and database migrations for managing Werewolf games across multiple servers.

## 📁 Structure

```
├── bot/              # Discord bot application
├── frontend/         # Web frontend application  
├── database/         # Database migrations and setup
└── README.md         # This file
```

## 🚀 Getting Started

### Prerequisites
- Node.js 18+
- PostgreSQL database
- Discord bot token

### Installation

1. Clone the repository
2. Install all dependencies:
   ```bash
   npm run install:all
   ```

## 📦 Individual Components

### 🤖 Discord Bot (`/bot`)
The Discord bot for managing Werewolf games.

**Quick Start:**
1. Copy `bot/.env.example` to `bot/.env` and fill in your values
2. Set up your PostgreSQL database using `database/migrate` script, see [database/README.md](database/README.md)
3. Start the bot: `npm run bot:start`

For detailed setup and commands, see [bot/README.md](bot/README.md).

### 🌐 Frontend (`/frontend`)
Web application for game management and statistics (coming soon).

**Development:**
```bash
npm run frontend:dev
```

### 🗄️ Database (`/database`)
Database migrations and setup scripts.

**Usage:**
```bash
npm run db:migrate
```

## 🛠️ Available Scripts

### Global Scripts
- `npm run install:all` - Install dependencies for all components
- `npm run bot:start` - Start the Discord bot
- `npm run bot:dev` - Start bot in development mode
- `npm run bot:test` - Run bot tests
- `npm run frontend:dev` - Start frontend development server
- `npm run frontend:build` - Build frontend for production
- `npm run db:migrate` - Run database migrations

### Individual Component Scripts
Each component has its own package.json with specific scripts. Use the workspace commands above or navigate to the specific directory.

## 🔧 Development

This monorepo uses npm workspaces for dependency management. Each component is independently deployable but shares common tooling and configuration.

### Contributing
1. Make changes in the appropriate component directory
2. Test your changes using the component-specific scripts
3. The CI/CD pipeline will automatically detect which components have changed

## 📄 Environment Variables

Each component may have its own environment variable requirements. See the individual component README files for specific details:

- [Bot Environment Variables](bot/README.md#environment-variables)
- Frontend Environment Variables (coming soon)
- Database Environment Variables (coming soon)

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes in the appropriate component directory
4. Run tests for the affected component
5. Submit a pull request

Changes will only trigger builds/deployments for the components that have been modified.

## 📄 License

This project is licensed under the MIT License.
