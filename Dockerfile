FROM node:18

WORKDIR /app

COPY backend/package*.json ./backend/
WORKDIR /app/backend
RUN npm install

COPY backend/ ./backend/

EXPOSE 3001

CMD ["npm", "start"]
