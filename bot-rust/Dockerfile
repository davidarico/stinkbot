# Stage 1: Build the application
FROM rust:latest as builder

# Install build tools
RUN apt-get update && apt-get install -y build-essential

# Create a new empty shell project
WORKDIR /usr/src/app
COPY . .

# Build for release
RUN cargo build --release

# Stage 2: Create the runtime image
FROM debian:slim

# Copy the compiled binary from the builder stage
COPY --from=builder /usr/src/app/target/release/stinkwolf /usr/local/bin/stinkwolf

# Set the command to run the bot
CMD ["stinkwolf"]
