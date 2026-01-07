FROM node:18

WORKDIR /app

# Copy package files first
COPY package*.json ./

# Install dependencies
# We don't need python/make/g++ manually because the Debian image has better support
RUN npm install --production

# Rebuild sqlite3 specifically for this architecture to be safe
RUN npm rebuild sqlite3

# Copy app source
COPY . .

# Create data directories and set permissions
RUN mkdir -p data && chmod 777 data
RUN mkdir -p public/uploads && chmod 777 public/uploads

# Expose port
EXPOSE 3000

# Start command
CMD ["node", "server.js"]
