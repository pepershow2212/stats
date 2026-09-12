# WARDOGS stats

Поллер RCON пишет килы, смерти и часы в SQLite. Discord-бот отвечает `/stats`, `/top`, `/live`, `/link`.

```bat
copy .env.example .env
npm install
npm test
npm start
```

Без боевого сервера: `npm run mock` (RCON на 127.0.0.1:7776, пароль `demo`).

`SERVER_*_RCON_*` те же, что в botconnectserver. Lifetime копится только после конца матча (сброс `matchSeconds` или смена карты).
