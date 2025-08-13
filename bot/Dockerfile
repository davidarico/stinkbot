# Use an official Node.js runtime as a parent image
FROM node:18-alpine

# Install SQLite and other dependencies
RUN apk add --no-cache sqlite

# Set the working directory in the container
WORKDIR /usr/src/app

# Create data directory for SQLite database
RUN mkdir -p /usr/src/app/data

# Copy package.json and package-lock.json (if available)
COPY package*.json ./

# Install app dependencies
RUN npm install --production

# Bundle app source
COPY . .

# Ensure data directory has proper permissions
RUN chmod 755 /usr/src/app/data

# Command to run the application
CMD [ "node", "src/index.js" ]