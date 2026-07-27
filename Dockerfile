FROM node:22-alpine
WORKDIR /app
COPY package*.json ./
RUN npm install --omit=dev --ignore-scripts
COPY . .
ENV PORT=3000
EXPOSE 3000
CMD ["node", "server.js"]
