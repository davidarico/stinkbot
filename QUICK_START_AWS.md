# 🚀 Quick Start: AWS Deployment

## Prerequisites
- AWS CLI installed and configured
- Docker installed and running
- Discord bot token

## Step 1: Deploy Infrastructure
```bash
npm run aws:infrastructure
```
This will create:
- VPC with public/private subnets
- RDS PostgreSQL database
- ECR repository
- ECS cluster
- IAM roles
- Security groups
- Secrets Manager entries

## Step 2: Build and Push Docker Image
```bash
npm run aws:build
```

## Step 3: Deploy the Bot Service
```bash
npm run aws:deploy
```

## Step 4: Monitor
- Check ECS console for service status
- View logs in CloudWatch: `/ecs/werewolf-bot`

## Local Development
```bash
# Start local environment with PostgreSQL
npm run docker:run

# View logs
npm run docker:logs

# Stop environment
npm run docker:stop
```

## Cost Estimate
- **Fargate (512 CPU, 1GB RAM)**: ~$15/month
- **RDS t3.micro**: ~$15/month
- **NAT Gateway**: ~$45/month
- **Total**: ~$75/month

For cost optimization, consider:
- Using Fargate Spot (50% savings)
- Stopping NAT Gateway if not needed
- Using smaller RDS instance for testing

## Troubleshooting
- Check CloudWatch logs for errors
- Verify Secrets Manager has correct values
- Ensure security groups allow traffic
- Confirm IAM roles have proper permissions
