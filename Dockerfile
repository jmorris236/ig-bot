FROM mcr.microsoft.com/playwright:v1.53.1-jammy

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .

CMD ["node", "autolike.js"]
