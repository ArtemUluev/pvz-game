const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static('public'));

// Игровые константы
const ROWS = 5;
const COLS = 9;
const FIELD_START_X = 150; // Где начинается поле
const FIELD_END_X = 150 + COLS * 85; // Где заканчивается поле (915)
const ZOMBIE_SPAWN_X = 1000; // Зомби появляются ЗА экраном

const PLANT_COSTS = { sunflower: 50, peashooter: 100, walnut: 50, snowpea: 175, cherrybomb: 150 };
const PLANT_HP = { sunflower: 80, peashooter: 80, walnut: 600, snowpea: 80, cherrybomb: 1 };
const ZOMBIE_COSTS = { basic: 40, cone: 70, bucket: 110 };
const ZOMBIE_STATS = {
  basic: { hp: 100, speed: 20, damage: 25, reward: 25 },
  cone: { hp: 200, speed: 17, damage: 25, reward: 40 },
  bucket: { hp: 400, speed: 14, damage: 35, reward: 60 }
};

let gameState = {
  plants: [],
  zombies: [],
  projectiles: [],
  sunDrops: [],
  sunPoints: 300, // Больше начального солнца
  zombieEnergy: 80, // Меньше начальной энергии
  score1: 0,
  score2: 0,
  gameOver: false,
  winner: null
};

let players = { defender: null, attacker: null };
let lastTime = Date.now();

function updateGame() {
  if (gameState.gameOver) return;
  
  const now = Date.now();
  const dt = Math.min(0.1, (now - lastTime) / 1000);
  lastTime = now;
  
  // Медленная регенерация энергии зомби
  gameState.zombieEnergy = Math.min(250, gameState.zombieEnergy + 4 * dt);
  
  // Растения
  gameState.plants.forEach(p => {
    if (!p.alive) return;
    p.shootTimer = (p.shootTimer || 0) - dt;
    
    // Подсолнух
    if (p.type === 'sunflower') {
      p.sunTimer = (p.sunTimer || 0) - dt;
      if (p.sunTimer <= 0) {
        gameState.sunDrops.push({ 
          x: p.x + (Math.random() - 0.5) * 40, 
          y: p.y - 15, 
          alive: true,
          value: 25
        });
        p.sunTimer = 8 + Math.random() * 4;
      }
    }
    
    // Стреляющие
    if ((p.type === 'peashooter' || p.type === 'snowpea') && p.shootTimer <= 0) {
      const hasZombie = gameState.zombies.some(z => 
        z.row === p.row && z.alive && z.x > p.x && z.x < FIELD_END_X + 100
      );
      if (hasZombie) {
        gameState.projectiles.push({
          x: p.x + 20, y: p.y, row: p.row,
          damage: p.type === 'snowpea' ? 20 : 25,
          slow: p.type === 'snowpea', alive: true
        });
        p.shootTimer = 1.5;
      }
    }
  });
  
  // Зомби
  gameState.zombies.forEach(z => {
    if (!z.alive) return;
    
    // Ищем растение на пути
    let blocking = gameState.plants.find(p => 
      p.alive && p.row === z.row && Math.abs(z.x - p.x) < 45
    );
    
    if (blocking) {
      z.attackTimer = (z.attackTimer || 0) - dt;
      if (z.attackTimer <= 0) {
        blocking.hp -= z.damage;
        z.attackTimer = 0.7;
        if (blocking.hp <= 0) blocking.alive = false;
      }
    } else {
      const speed = z.slowed ? z.speed * 0.4 : z.speed;
      z.x -= speed * dt;
    }
    
    // Зомби дошёл до дома (левая граница поля)
    if (z.x < FIELD_START_X - 20) {
      z.alive = false;
      gameState.score2++;
      if (gameState.score2 >= 5) {
        gameState.gameOver = true;
        gameState.winner = 'attacker';
      }
    }
    
    if (z.hp <= 0) {
      z.alive = false;
      gameState.score1++;
      gameState.sunPoints += z.reward;
      if (gameState.score1 >= 5) {
        gameState.gameOver = true;
        gameState.winner = 'defender';
      }
    }
  });
  
  // Снаряды
  gameState.projectiles.forEach(p => {
    if (!p.alive) return;
    p.x += 400 * dt;
    
    gameState.zombies.forEach(z => {
      if (!z.alive || z.row !== p.row) return;
      if (Math.abs(p.x - z.x) < 22) {
        z.hp -= p.damage;
        if (p.slow) z.slowed = true;
        p.alive = false;
      }
    });
    
    if (p.x > 1050) p.alive = false;
  });
  
  // Случайное солнце
  if (Math.random() < dt * 0.12) {
    gameState.sunDrops.push({ 
      x: FIELD_START_X + Math.random() * (FIELD_END_X - FIELD_START_X), 
      y: 90, 
      alive: true,
      value: 25
    });
  }
  
  // Очистка
  gameState.plants = gameState.plants.filter(p => p.alive);
  gameState.zombies = gameState.zombies.filter(z => z.alive);
  gameState.projectiles = gameState.projectiles.filter(p => p.alive);
  gameState.sunDrops = gameState.sunDrops.filter(s => s.alive);
}

// Игровой цикл
setInterval(() => {
  if (players.defender && players.attacker && !gameState.gameOver) {
    updateGame();
  }
  
  const state = {
    plants: gameState.plants.filter(p => p.alive).map(p => ({
      type: p.type, row: p.row, col: p.col, x: p.x, y: p.y, 
      hp: p.hp, maxHp: p.maxHp
    })),
    zombies: gameState.zombies.filter(z => z.alive).map(z => ({
      type: z.type, row: z.row, x: z.x, y: z.y, 
      hp: z.hp, maxHp: z.maxHp, slowed: z.slowed || false
    })),
    projectiles: gameState.projectiles.filter(p => p.alive).map(p => ({
      x: p.x, y: p.y, row: p.row, slow: p.slow
    })),
    sunDrops: gameState.sunDrops.filter(s => s.alive).map((s, i) => ({
      id: i, x: s.x, y: s.y, value: s.value, alive: s.alive
    })),
    sunPoints: Math.floor(gameState.sunPoints),
    zombieEnergy: Math.floor(gameState.zombieEnergy),
    score1: gameState.score1,
    score2: gameState.score2,
    gameOver: gameState.gameOver,
    winner: gameState.winner
  };
  
  io.emit('state', state);
}, 1000 / 30);

io.on('connection', (socket) => {
  console.log('Подключился:', socket.id);
  
  if (!players.defender) {
    players.defender = socket.id;
    socket.emit('role', 'defender');
  } else if (!players.attacker) {
    players.attacker = socket.id;
    socket.emit('role', 'attacker');
  } else {
    socket.emit('error', 'Игра заполнена');
    socket.disconnect();
    return;
  }
  
  socket.on('plant', (data) => {
    if (socket.id !== players.defender || gameState.gameOver) return;
    if (gameState.sunPoints < PLANT_COSTS[data.type]) return;
    if (data.row < 0 || data.row >= ROWS || data.col < 0 || data.col >= COLS) return;
    if (gameState.plants.some(p => p.alive && p.row === data.row && p.col === data.col)) return;
    
    gameState.sunPoints -= PLANT_COSTS[data.type];
    gameState.plants.push({
      type: data.type, row: data.row, col: data.col,
      x: FIELD_START_X + data.col * 85 + 42,
      y: 120 + data.row * 90 + 45,
      hp: PLANT_HP[data.type], maxHp: PLANT_HP[data.type],
      shootTimer: 0, sunTimer: 0, alive: true
    });
  });
  
  socket.on('collect', (data) => {
    if (socket.id !== players.defender) return;
    const sun = gameState.sunDrops[data.id];
    if (sun && sun.alive) {
      gameState.sunPoints += sun.value;
      sun.alive = false;
    }
  });
  
  socket.on('zombie', (data) => {
    if (socket.id !== players.attacker || gameState.gameOver) return;
    if (!ZOMBIE_COSTS[data.type]) return;
    if (gameState.zombieEnergy < ZOMBIE_COSTS[data.type]) return;
    
    const row = data.row !== undefined ? data.row : Math.floor(Math.random() * ROWS);
    if (row < 0 || row >= ROWS) return;
    
    gameState.zombieEnergy -= ZOMBIE_COSTS[data.type];
    const s = ZOMBIE_STATS[data.type];
    gameState.zombies.push({
      type: data.type, row: row,
      x: ZOMBIE_SPAWN_X + Math.random() * 80, // Далеко за экраном
      y: 120 + row * 90 + 45,
      hp: s.hp, maxHp: s.hp, speed: s.speed,
      damage: s.damage, reward: s.reward,
      attackTimer: 0.5, // Небольшая задержка перед атакой
      slowed: false, alive: true
    });
  });
  
  socket.on('horde', () => {
    if (socket.id !== players.attacker || gameState.gameOver) return;
    
    const types = ['basic', 'basic', 'cone'];
    types.forEach(type => {
      if (gameState.zombieEnergy < ZOMBIE_COSTS[type]) return;
      gameState.zombieEnergy -= ZOMBIE_COSTS[type];
      const s = ZOMBIE_STATS[type];
      const row = Math.floor(Math.random() * ROWS);
      gameState.zombies.push({
        type, row: row,
        x: ZOMBIE_SPAWN_X + Math.random() * 100,
        y: 120 + row * 90 + 45,
        hp: s.hp, maxHp: s.hp, speed: s.speed,
        damage: s.damage, reward: s.reward,
        attackTimer: 0.5, slowed: false, alive: true
      });
    });
  });
  
  socket.on('restart', () => {
    gameState = {
      plants: [],
      zombies: [],
      projectiles: [],
      sunDrops: [],
      sunPoints: 300,
      zombieEnergy: 80,
      score1: 0,
      score2: 0,
      gameOver: false,
      winner: null
    };
    lastTime = Date.now();
  });
  
  socket.on('disconnect', () => {
    console.log('Отключился:', socket.id);
    if (socket.id === players.defender) players.defender = null;
    if (socket.id === players.attacker) players.attacker = null;
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log('Сервер на порту ' + PORT));
