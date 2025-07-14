#!/bin/bash

# Build script for creating and pushing Docker image to AWS ECR

set -e

# Configuration
AWS_REGION="us-east-1"  # Change this to your preferred region
ECR_REPOSITORY="werewolf-discord-bot"
IMAGE_TAG="latest"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${YELLOW}Starting Docker build and push process...${NC}"

# Check if AWS CLI is installed
if ! command -v aws &> /dev/null; then
    echo -e "${RED}AWS CLI is not installed. Please install it first.${NC}"
    exit 1
fi

# Check if Docker is running
if ! docker info > /dev/null 2>&1; then
    echo -e "${RED}Docker is not running. Please start Docker first.${NC}"
    exit 1
fi

# Get AWS account ID
AWS_ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
if [ $? -ne 0 ]; then
    echo -e "${RED}Failed to get AWS account ID. Please ensure AWS CLI is configured.${NC}"
    exit 1
fi

# Construct ECR repository URI
ECR_URI="${AWS_ACCOUNT_ID}.dkr.ecr.${AWS_REGION}.amazonaws.com/${ECR_REPOSITORY}"

echo -e "${YELLOW}AWS Account ID: ${AWS_ACCOUNT_ID}${NC}"
echo -e "${YELLOW}ECR Repository URI: ${ECR_URI}${NC}"

# Create ECR repository if it doesn't exist
echo -e "${YELLOW}Checking if ECR repository exists...${NC}"
aws ecr describe-repositories --repository-names ${ECR_REPOSITORY} --region ${AWS_REGION} > /dev/null 2>&1 || {
    echo -e "${YELLOW}Creating ECR repository...${NC}"
    aws ecr create-repository \
        --repository-name ${ECR_REPOSITORY} \
        --region ${AWS_REGION} \
        --image-scanning-configuration scanOnPush=true
}

# Login to ECR
echo -e "${YELLOW}Logging into ECR...${NC}"
aws ecr get-login-password --region ${AWS_REGION} | docker login --username AWS --password-stdin ${ECR_URI}

# Build Docker image
echo -e "${YELLOW}Building Docker image...${NC}"
docker build -t ${ECR_REPOSITORY}:${IMAGE_TAG} .

# Tag image for ECR
echo -e "${YELLOW}Tagging image for ECR...${NC}"
docker tag ${ECR_REPOSITORY}:${IMAGE_TAG} ${ECR_URI}:${IMAGE_TAG}

# Push image to ECR
echo -e "${YELLOW}Pushing image to ECR...${NC}"
docker push ${ECR_URI}:${IMAGE_TAG}

# Also tag and push with timestamp
TIMESTAMP=$(date +%Y%m%d-%H%M%S)
docker tag ${ECR_REPOSITORY}:${IMAGE_TAG} ${ECR_URI}:${TIMESTAMP}
docker push ${ECR_URI}:${TIMESTAMP}

echo -e "${GREEN}✅ Docker image successfully built and pushed!${NC}"
echo -e "${GREEN}Image URI: ${ECR_URI}:${IMAGE_TAG}${NC}"
echo -e "${GREEN}Timestamp tag: ${ECR_URI}:${TIMESTAMP}${NC}"

# Clean up local images to save space
echo -e "${YELLOW}Cleaning up local images...${NC}"
docker rmi ${ECR_REPOSITORY}:${IMAGE_TAG} || true
docker rmi ${ECR_URI}:${IMAGE_TAG} || true
docker rmi ${ECR_URI}:${TIMESTAMP} || true

echo -e "${GREEN}✅ Build and push completed successfully!${NC}"
