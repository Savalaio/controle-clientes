FROM node:18

WORKDIR /app

# Copy all files first
COPY . .

# Force remove node_modules if they were copied by mistake
# This ensures we don't use Windows binaries on Linux
RUN rm -rf node_modules

# Install dependencies
RUN npm install --production

# Rebuild sqlite3 from source to ensure architecture compatibility
# This fixes the "Exec format error" and "ERR_DLOPEN_FAILED"
RUN npm rebuild sqlite3 --build-from-source

# Create data directories and set permissions
RUN mkdir -p data && chmod 777 data
RUN mkdir -p public/uploads && chmod 777 public/uploads

# Expose port
EXPOSE 3000

# Start command
CMD ["node", "server.js"]
