# Discord Werewolf Bot - Docker & AWS Deployment Guide

This document provides instructions for dockerizing and deploying Stinkbot to AWS.

## 📦 Files Created

The following files have been added to support Docker and AWS deployment:

- `Dockerfile` - Multi-stage Docker build for the bot
- `docker-compose.yml` - Local development environment
- `docker-compose.prod.yml` - Production environment
- `.dockerignore` - Files to exclude from Docker build
- `build-and-push.sh` - Script to build and push to AWS ECR
- `deploy-aws.sh` - Script to deploy to AWS ECS
- `aws-task-definition.json` - ECS task definition template

## 🚀 Quick Start

### Local Development with Docker

1. **Set up environment variables:**
   ```bash
   cp .env.example .env
   # Edit .env with your Discord token and other settings
   ```

2. **Start the development environment:**
   ```bash
   docker-compose up -d
   ```

3. **View logs:**
   ```bash
   docker-compose logs -f bot
   ```

4. **Stop the environment:**
   ```bash
   docker-compose down
   ```

## ☁️ AWS Deployment

### Prerequisites

1. **AWS CLI installed and configured:**
   ```bash
   aws configure
   ```

2. **Docker installed and running**

3. **Required AWS services:**
   - AWS ECS (Elastic Container Service)
   - AWS ECR (Elastic Container Registry)
   - AWS RDS (for PostgreSQL database)
   - AWS Secrets Manager (for storing sensitive data)
   - AWS VPC with subnets and security groups

### Step 1: Set up AWS RDS Database

1. Create a PostgreSQL RDS instance
2. Note the endpoint, port, database name, username, and password
3. Ensure your ECS security group can access the RDS instance

### Step 2: Store Secrets in AWS Secrets Manager

Create secrets for the following:
```bash
aws secretsmanager create-secret \
    --name "werewolf-bot/discord-token" \
    --description "Discord bot token" \
    --secret-string "your_discord_bot_token"

aws secretsmanager create-secret \
    --name "werewolf-bot/database-host" \
    --description "Database host" \
    --secret-string "your_rds_endpoint"

aws secretsmanager create-secret \
    --name "werewolf-bot/database-port" \
    --description "Database port" \
    --secret-string "5432"

aws secretsmanager create-secret \
    --name "werewolf-bot/database-name" \
    --description "Database name" \
    --secret-string "werewolf_bot"

aws secretsmanager create-secret \
    --name "werewolf-bot/database-user" \
    --description "Database user" \
    --secret-string "your_db_user"

aws secretsmanager create-secret \
    --name "werewolf-bot/database-password" \
    --description "Database password" \
    --secret-string "your_db_password"
```

### Step 3: Create IAM Roles

Create the following IAM roles:

1. **ECS Task Execution Role** (`ecsTaskExecutionRole`):
   ```json
   {
       "Version": "2012-10-17",
       "Statement": [
           {
               "Effect": "Allow",
               "Action": [
                   "ecr:GetAuthorizationToken",
                   "ecr:BatchCheckLayerAvailability",
                   "ecr:GetDownloadUrlForLayer",
                   "ecr:BatchGetImage",
                   "logs:CreateLogStream",
                   "logs:PutLogEvents",
                   "secretsmanager:GetSecretValue"
               ],
               "Resource": "*"
           }
       ]
   }
   ```

2. **ECS Task Role** (`ecsTaskRole`) - for any additional AWS services your bot might need.

### Step 4: Build and Push Docker Image

1. **Edit the build script** if needed:
   ```bash
   nano build-and-push.sh
   # Update AWS_REGION and ECR_REPOSITORY if needed
   ```

2. **Run the build script:**
   ```bash
   ./build-and-push.sh
   ```

### Step 5: Deploy to ECS

1. **Update the task definition:**
   - Edit `aws-task-definition.json`
   - Replace `YOUR_ACCOUNT_ID` with your actual AWS account ID
   - Update region if different from `us-east-1`

2. **Update the deployment script:**
   ```bash
   nano deploy-aws.sh
   # Update AWS_REGION, CLUSTER_NAME, SERVICE_NAME if needed
   ```

3. **Run the deployment script:**
   ```bash
   ./deploy-aws.sh
   ```

4. **Create the ECS service** (first time only):
   The script will provide you with the command to create the service.
   You'll need to specify your subnet IDs and security group ID:
   ```bash
   aws ecs create-service \
       --cluster werewolf-bot-cluster \
       --service-name werewolf-bot-service \
       --task-definition werewolf-bot-task \
       --desired-count 1 \
       --launch-type FARGATE \
       --network-configuration "awsvpcConfiguration={subnets=[subnet-xxxxxxxxx,subnet-yyyyyyyyy],securityGroups=[sg-zzzzzzzzz],assignPublicIp=ENABLED}" \
       --region us-east-1
   ```

## 🔧 Configuration

### Environment Variables

The bot uses the following environment variables:

- `DISCORD_TOKEN` - Your Discord bot token
- `PG_HOST` - PostgreSQL host
- `PG_PORT` - PostgreSQL port (default: 5432)
- `PG_DATABASE` - Database name
- `PG_USER` - Database username
- `PG_PASSWORD` - Database password
- `BOT_PREFIX` - Bot command prefix (default: Wolf.)
- `NODE_ENV` - Environment (production/development)

### Database Setup

The database schema will be automatically created when the container starts. The `database_setup.sql` file is included in the Docker image.

## 📊 Monitoring

### CloudWatch Logs

Logs are automatically sent to CloudWatch under the log group `/ecs/werewolf-bot`.

### Health Checks

The container includes a health check that runs every 30 seconds to ensure the bot is running properly.

### Viewing Logs

```bash
# View ECS service logs
aws logs tail /ecs/werewolf-bot --follow

# Or use the AWS Console to view logs
```

## 🔄 Updates and Maintenance

### Updating the Bot

1. Make your code changes
2. Build and push new image:
   ```bash
   ./build-and-push.sh
   ```
3. Deploy the update:
   ```bash
   ./deploy-aws.sh
   ```

### Scaling

To change the number of running instances:
```bash
aws ecs update-service \
    --cluster werewolf-bot-cluster \
    --service werewolf-bot-service \
    --desired-count 2
```

## 💰 Cost Optimization

- **Fargate Spot**: Consider using Fargate Spot for cost savings
- **Auto Scaling**: Set up auto scaling based on CPU/memory usage
- **Reserved Capacity**: For long-running bots, consider reserved capacity

## 🔒 Security Best Practices

1. **Secrets Management**: All sensitive data is stored in AWS Secrets Manager
2. **IAM Roles**: Minimal permissions for ECS tasks
3. **VPC**: Bot runs in private subnets with proper security groups
4. **Non-root User**: Docker container runs as non-root user
5. **Image Scanning**: ECR automatically scans for vulnerabilities

## 🚨 Troubleshooting

### Common Issues

1. **Bot not starting**: Check CloudWatch logs for error messages
2. **Database connection issues**: Verify RDS security groups and connection strings
3. **Permission errors**: Check IAM roles and policies
4. **Image not found**: Ensure ECR repository exists and image was pushed successfully

### Useful Commands

```bash
# Check service status
aws ecs describe-services --cluster werewolf-bot-cluster --services werewolf-bot-service

# View task logs
aws ecs describe-tasks --cluster werewolf-bot-cluster --tasks TASK_ID

# Force new deployment
aws ecs update-service --cluster werewolf-bot-cluster --service werewolf-bot-service --force-new-deployment
```

## 📞 Support

For issues related to the Discord bot functionality, check the `ISSUE_TRACKING.md` file.

For AWS deployment issues, review the CloudWatch logs and ensure all prerequisites are met.
