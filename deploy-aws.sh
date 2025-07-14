#!/bin/bash

# AWS ECS deployment script

set -e

# Configuration - Update these values
AWS_REGION="us-east-1"
CLUSTER_NAME="werewolf-bot-cluster"
SERVICE_NAME="werewolf-bot-service"
TASK_DEFINITION="werewolf-bot-task"
ECR_REPOSITORY="werewolf-discord-bot"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

echo -e "${YELLOW}Starting AWS ECS deployment...${NC}"

# Check if AWS CLI is installed
if ! command -v aws &> /dev/null; then
    echo -e "${RED}AWS CLI is not installed. Please install it first.${NC}"
    exit 1
fi

# Get AWS account ID
AWS_ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
if [ $? -ne 0 ]; then
    echo -e "${RED}Failed to get AWS account ID. Please ensure AWS CLI is configured.${NC}"
    exit 1
fi

# Update task definition with actual account ID
echo -e "${YELLOW}Updating task definition with account ID...${NC}"
sed "s/YOUR_ACCOUNT_ID/${AWS_ACCOUNT_ID}/g" aws-task-definition.json > aws-task-definition-updated.json

# Create/Update ECS Cluster
echo -e "${YELLOW}Creating/updating ECS cluster...${NC}"
aws ecs create-cluster \
    --cluster-name ${CLUSTER_NAME} \
    --capacity-providers FARGATE \
    --default-capacity-provider-strategy capacityProvider=FARGATE,weight=1 \
    --region ${AWS_REGION} || echo "Cluster might already exist"

# Create CloudWatch Log Group
echo -e "${YELLOW}Creating CloudWatch log group...${NC}"
aws logs create-log-group \
    --log-group-name "/ecs/werewolf-bot" \
    --region ${AWS_REGION} || echo "Log group might already exist"

# Register task definition
echo -e "${YELLOW}Registering task definition...${NC}"
aws ecs register-task-definition \
    --cli-input-json file://aws-task-definition-updated.json \
    --region ${AWS_REGION}

# Get the latest task definition ARN
TASK_DEFINITION_ARN=$(aws ecs describe-task-definition \
    --task-definition ${TASK_DEFINITION} \
    --region ${AWS_REGION} \
    --query 'taskDefinition.taskDefinitionArn' \
    --output text)

echo -e "${YELLOW}Latest task definition: ${TASK_DEFINITION_ARN}${NC}"

# Check if service exists
SERVICE_EXISTS=$(aws ecs describe-services \
    --cluster ${CLUSTER_NAME} \
    --services ${SERVICE_NAME} \
    --region ${AWS_REGION} \
    --query 'services[0].status' \
    --output text 2>/dev/null || echo "MISSING")

if [ "$SERVICE_EXISTS" = "MISSING" ] || [ "$SERVICE_EXISTS" = "None" ]; then
    echo -e "${YELLOW}Creating new ECS service...${NC}"
    
    # Note: You'll need to update the subnet and security group IDs
    echo -e "${RED}IMPORTANT: You need to update the subnet IDs and security group ID in this command!${NC}"
    echo -e "${YELLOW}Please run the following command with your actual subnet and security group IDs:${NC}"
    echo ""
    echo "aws ecs create-service \\"
    echo "    --cluster ${CLUSTER_NAME} \\"
    echo "    --service-name ${SERVICE_NAME} \\"
    echo "    --task-definition ${TASK_DEFINITION_ARN} \\"
    echo "    --desired-count 1 \\"
    echo "    --launch-type FARGATE \\"
    echo "    --network-configuration \"awsvpcConfiguration={subnets=[subnet-xxxxxxxxx,subnet-yyyyyyyyy],securityGroups=[sg-zzzzzzzzz],assignPublicIp=ENABLED}\" \\"
    echo "    --region ${AWS_REGION}"
    echo ""
else
    echo -e "${YELLOW}Updating existing ECS service...${NC}"
    aws ecs update-service \
        --cluster ${CLUSTER_NAME} \
        --service ${SERVICE_NAME} \
        --task-definition ${TASK_DEFINITION_ARN} \
        --region ${AWS_REGION}
    
    echo -e "${YELLOW}Waiting for service to stabilize...${NC}"
    aws ecs wait services-stable \
        --cluster ${CLUSTER_NAME} \
        --services ${SERVICE_NAME} \
        --region ${AWS_REGION}
fi

# Clean up temporary file
rm -f aws-task-definition-updated.json

echo -e "${GREEN}✅ Deployment process completed!${NC}"
echo -e "${GREEN}Check the ECS console to monitor your service status.${NC}"
