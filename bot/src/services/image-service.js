const https = require('https');
const http = require('http');
const { URL } = require('url');
const { PutObjectCommand } = require('@aws-sdk/client-s3');

class ImageService {
    constructor(s3Client) {
        this.s3Client = s3Client;
    }

    /**
     * Download an image from a URL and return the buffer
     * Note: Images are stored in memory only, not saved to disk
     */
    async downloadImage(url) {
        return new Promise((resolve, reject) => {
            const urlObj = new URL(url);
            const protocol = urlObj.protocol === 'https:' ? https : http;

            const request = protocol.get(url, (response) => {
                if (response.statusCode !== 200) {
                    reject(new Error(`Failed to download image: ${response.statusCode}`));
                    return;
                }

                const chunks = [];
                response.on('data', (chunk) => {
                    chunks.push(chunk);
                });

                response.on('end', () => {
                    const buffer = Buffer.concat(chunks);
                    resolve(buffer);
                });
            });

            request.on('error', (error) => {
                reject(error);
            });

            request.setTimeout(30000, () => {
                request.destroy();
                reject(new Error('Download timeout'));
            });
        });
    }

    /**
     * Upload an image buffer to S3 and return the public URL
     * Note: Images are uploaded directly from memory, no temporary files created
     */
    async uploadImageToS3(imageBuffer, originalUrl, messageId, imageIndex = 0) {
        if (!this.s3Client) {
            throw new Error('S3 client not configured');
        }

        try {
            // Use the specific bucket for images
            const imageBucketName = 'stinkwolf-images';

            // Generate filename using message ID and index to handle multiple images per message
            const extension = this.getImageExtension(originalUrl);
            const filename = imageIndex === 0
                ? `discord-images/${messageId}${extension}`
                : `discord-images/${messageId}_${imageIndex}${extension}`;

            const uploadParams = {
                Bucket: imageBucketName,
                Key: filename,
                Body: imageBuffer,
                ContentType: this.getContentType(extension)
            };

            await this.s3Client.send(new PutObjectCommand(uploadParams));

            // Return the public S3 URL
            return `https://${imageBucketName}.s3.${process.env.AWS_REGION}.amazonaws.com/${filename}`;
        } catch (error) {
            console.error('Error uploading image to S3:', error);
            throw error;
        }
    }

    /**
     * Get file extension from URL
     */
    getImageExtension(url) {
        try {
            const urlObj = new URL(url);
            const pathname = urlObj.pathname;
            const extension = pathname.split('.').pop().toLowerCase();

            // Validate extension is an image
            const validExtensions = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp'];
            if (validExtensions.includes(extension)) {
                return `.${extension}`;
            }

            // Default to .jpg if no valid extension found
            return '.jpg';
        } catch (error) {
            return '.jpg';
        }
    }

    /**
     * Get content type based on file extension
     */
    getContentType(extension) {
        const contentTypes = {
            '.jpg': 'image/jpeg',
            '.jpeg': 'image/jpeg',
            '.png': 'image/png',
            '.gif': 'image/gif',
            '.webp': 'image/webp',
            '.bmp': 'image/bmp'
        };
        return contentTypes[extension] || 'image/jpeg';
    }

    /**
     * Process Discord image URLs in message content and replace with S3 URLs
     */
    async processDiscordImages(messageContent, messageId) {
        if (!this.s3Client) {
            return messageContent; // Return original content if S3 not configured
        }

        // Regex to match Discord CDN URLs (including query parameters)
        const discordImageRegex = /https:\/\/cdn\.discordapp\.com\/attachments\/\d+\/\d+\/[^\s]+/g;
        const matches = messageContent.match(discordImageRegex);

        if (!matches) {
            return messageContent;
        }

        let processedContent = messageContent;
        let imageIndex = 0;

        for (const imageUrl of matches) {
            let imageBuffer = null;
            try {
                console.log(`Processing Discord image: ${imageUrl}`);

                // Download the image to memory (no disk storage)
                imageBuffer = await this.downloadImage(imageUrl);

                // Upload to S3
                const s3Url = await this.uploadImageToS3(imageBuffer, imageUrl, messageId, imageIndex);

                // Replace the Discord URL with S3 URL
                processedContent = processedContent.replace(imageUrl, s3Url);

                imageIndex++;

                console.log(`Successfully processed image: ${imageUrl} -> ${s3Url}`);

                // Add a small delay to avoid overwhelming the APIs
                await new Promise(resolve => setTimeout(resolve, 100));

            } catch (error) {
                console.error(`Failed to process image ${imageUrl}:`, error);
                // Keep the original URL if processing fails
            } finally {
                // Explicitly clear the buffer from memory
                if (imageBuffer) {
                    imageBuffer = null;
                }
            }
        }

        return processedContent;
    }
}

module.exports = ImageService;
