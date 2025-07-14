#!/bin/bash

# Deploy AWS infrastructure using CloudFormation

set -e

# Configuration
STACK_NAME="werewolf-bot-infrastructure"
TEMPLATE_FILE="aws-infrastructure.yml"
AWS_REGION="us-east-1"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

echo -e "${YELLOW}Deploying AWS infrastructure for Werewolf Bot...${NC}"

# Check if AWS CLI is installed
if ! command -v aws &> /dev/null; then
    echo -e "${RED}AWS CLI is not installed. Please install it first.${NC}"
    exit 1
fi

# Prompt for required parameters
echo -e "${YELLOW}Please provide the following information:${NC}"

read -s -p "Discord Bot Token: " DISCORD_TOKEN
echo
read -s -p "Database Password (min 8 characters): " DB_PASSWORD
echo
read -p "Database Username [werewolf_user]: " DB_USERNAME
DB_USERNAME=${DB_USERNAME:-werewolf_user}

echo -e "${YELLOW}Deploying CloudFormation stack...${NC}"

# Deploy the stack
aws cloudformation deploy \
    --template-file ${TEMPLATE_FILE} \
    --stack-name ${STACK_NAME} \
    --parameter-overrides \
        DBUsername=${DB_USERNAME} \
        DBPassword=${DB_PASSWORD} \
        DiscordToken=${DISCORD_TOKEN} \
    --capabilities CAPABILITY_NAMED_IAM \
    --region ${AWS_REGION}

if [ $? -eq 0 ]; then
    echo -e "${GREEN}✅ Infrastructure deployed successfully!${NC}"
    
    # Get outputs
    echo -e "${YELLOW}Fetching stack outputs...${NC}"
    
    VPC_ID=$(aws cloudformation describe-stacks \
        --stack-name ${STACK_NAME} \
        --region ${AWS_REGION} \
        --query 'Stacks[0].Outputs[?OutputKey==`VPCId`].OutputValue' \
        --output text)
    
    PUBLIC_SUBNETS=$(aws cloudformation describe-stacks \
        --stack-name ${STACK_NAME} \
        --region ${AWS_REGION} \
        --query 'Stacks[0].Outputs[?OutputKey==`PublicSubnets`].OutputValue' \
        --output text)
    
    ECS_SG=$(aws cloudformation describe-stacks \
        --stack-name ${STACK_NAME} \
        --region ${AWS_REGION} \
        --query 'Stacks[0].Outputs[?OutputKey==`ECSSecurityGroupId`].OutputValue' \
        --output text)
    
    ECR_URI=$(aws cloudformation describe-stacks \
        --stack-name ${STACK_NAME} \
        --region ${AWS_REGION} \
        --query 'Stacks[0].Outputs[?OutputKey==`ECRRepositoryURI`].OutputValue' \
        --output text)
    
    RDS_ENDPOINT=$(aws cloudformation describe-stacks \
        --stack-name ${STACK_NAME} \
        --region ${AWS_REGION} \
        --query 'Stacks[0].Outputs[?OutputKey==`RDSEndpoint`].OutputValue' \
        --output text)
    
    echo -e "${GREEN}Infrastructure Details:${NC}"
    echo "VPC ID: ${VPC_ID}"
    echo "Public Subnets: ${PUBLIC_SUBNETS}"
    echo "ECS Security Group: ${ECS_SG}"
    echo "ECR Repository: ${ECR_URI}"
    echo "RDS Endpoint: ${RDS_ENDPOINT}"
    
    echo -e "${YELLOW}Next steps:${NC}"
    echo "1. Build and push your Docker image: ./build-and-push.sh"
    echo "2. Update deploy-aws.sh with the subnet IDs: ${PUBLIC_SUBNETS}"
    echo "3. Update deploy-aws.sh with the security group ID: ${ECS_SG}"
    echo "4. Deploy the ECS service: ./deploy-aws.sh"
    
else
    echo -e "${RED}❌ Infrastructure deployment failed!${NC}"
    exit 1
fi
