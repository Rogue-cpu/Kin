FROM node:24-bookworm-slim
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts
COPY --chown=node:node notifications.mjs server.mjs messages.mjs calls.mjs chat-attachments.mjs gif-validation.mjs schema.sql ./
COPY --chown=node:node dist ./dist
USER node
ENV NODE_ENV=production
CMD ["node", "server.mjs"]
