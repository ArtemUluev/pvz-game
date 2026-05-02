const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*' }
});

app.use(express.static('public'));

app.get('/', (req, res) => {
  res.sendFile(__dirname + '/public/index.html');
});

// Игровые константы
const ROWS = 5, COLS = 9;
const PLANT_COSTS = {
  sunflower: 50, peashooter: 100, walnut: 50, snowpea: 175, cherrybomb: 150
};
const PLANT_HP = {
  sunflower: 80, peashooter: 80, walnut: 600, snowpea: 80, cherrybomb: 1
};
const ZOMBIE_COSTS = {
  basic: 40, cone: 70, bucket: 110
};
const ZOMBIE_STATS = {
  basic: { hp: 100, speed: 25, damage: 25, reward: 25 },
  cone: { hp: 200, speed: 22, damage: 25, reward: 40 },
  bucket: { hp: 400, speed: 18, damage: 35, reward: 60 }
};

// Состояние игры
let gameState = {
  plants: [],
  zombies: [],
  projectiles: [],
  sunDrops: [],
  sunPoints: 200,
  zombieEnergy: 100,
  maxEnergy: 250,
  score1: 0,
  score2: 0,
  gameOver: false,
  winner: null
};

let players = { defender: null, attacker: null };
let gameInterval = null;

// Сброс игры
function resetGame() {
  gameState = {
    plants: [],
    zombies: [],
    projectiles: [],
    sunDrops: [],
    sunPoints: 200,
    zombieEnergy: 100,
    maxEnergy: 250,
    score1: 0,
    score2: 0,
    gameOver: false,
    winner: null
  };
}

// Игровой цикл
function updateGame(dt) {
  if (gameState.gameOver) return;

  // Регенерация энергии зомби
  gameState.zombieEnergy = Math.min(gameState.maxEnergy, gameState.zombieEnergy + 8 * dt);

  // Обновление растений
  gameState.plants.forEach(p => {
    if (!p.alive) return;

    // Подсолнух производит солнце
    if (p.type === 'sunflower') {
      p.sunTimer -= dt;
      if (p.sunTimer <= 0) {
        gameState.sunDrops.push({
          x: p.x + (Math.random() - 0.5) * 40,
          y: p.y - 20,
          alive: true,
          value: 25
        });
        p.sunTimer = 8 + Math.random() * 4;
      }
    }

    // Стреляющие растения
    if (p.type === 'peashooter' || p.type === 'snowpea') {
      p.shootTimer -= dt;
      if (p.shootTimer <= 0) {
        const hasZombie = gameState.zombies.some(z => z.row === p.row && z.alive && z.x > p.x);
        if (hasZombie) {
          gameState.projectiles.push({
            x: p.x + 20, y: p.y, row: p.row,
            damage: p.type === 'snowpea' ? 20 : 25,
            slow: p.type === 'snowpea',
            alive: true
          });
          p.shootTimer = 1.5 + Math.random() * 0.5;
        }
      }
    }
  });

  // Обновление зомби
  gameState.zombies.forEach(z => {
    if (!z.alive) return;

    let blocking = gameState.plants.find(p => 
      p.alive && p.row === z.row && Math.abs(z.x - p.x) < 50
    );

    if (blocking) {
      z.attackTimer -= dt;
      if (z.attackTimer <= 0) {
        blocking.hp -= z.damage;
        z.attackTimer = 0.7;
        if (blocking.hp <= 0) blocking.alive = false;
      }
    } else {
      const speed = z.slowed ? z.speed * 0.4 : z.speed;
      z.x -= speed * dt;
    }

    if (z.slowed) {
      z.slowTimer -= dt;
      if (z.slowTimer <= 0) z.slowed = false;
    }

    if (z.x < 100) {
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

  // Обновление снарядов
  gameState.projectiles.forEach(p => {
    if (!p.alive) return;
    p.x += 400 * dt;

    gameState.zombies.forEach(z => {
      if (!z.alive || z.row !== p.row) return;
      if (Math.abs(p.x - z.x) < 25) {
        z.hp -= p.damage;
        if (p.slow) {
          z.slowed = true;
          z.slowTimer = 2;
        }
        p.alive = false;
      }
    });

    if (p.x > 1000) p.alive = false;
  });

  // Случайное солнце
  if (Math.random() < dt * 0.1) {
    gameState.sunDrops.push({
      x: 150 + Math.random() * 700,
      y: 80,
      alive: true,
      value: 25
    });
  }

  // Очистка мёртвых
  gameState.plants = gameState.plants.filter(p => p.alive);
  gameState.zombies = gameState.zombies.filter(z => z.alive);
  gameState.projectiles = gameState.projectiles.filter(p => p.alive);
  gameState.sunDrops = gameState.sunDrops.filter(s => s.alive);
}

// Отправка состояния
function broadcastState() {
  const state = {
    plants: gameState.plants.filter(p => p.alive).map(p => ({
      type: p.type, row: p.row, col: p.col, x: p.x, y: p.y, hp: p.hp, maxHp: p.maxHp
    })),
    zombies: gameState.zombies.filter(z => z.alive).map(z => ({
      type: z.type, row: z.row, x: z.x, y: z.y, hp: z.hp, maxHp: z.maxHp, slowed: z.slowed
    })),
    projectiles: gameState.projectiles.filter(p => p.alive).map(p => ({
      x: p.x, y: p.y, row: p.row, slow: p.slow
    })),
    sunDrops: gameState.sunDrops.filter(s => s.alive).map((s, i) => ({
      id: i, x: s.x, y: s.y, value: s.value
    })),
    sunPoints: Math.floor(gameState.sunPoints),
    zombieEnergy: Math.floor(gameState.zombieEnergy),
    score1: gameState.score1,
    score2: gameState.score2,
    gameOver: gameState.gameOver,
    winner: gameState.winner
  };
  
  io.emit('state', state);
}

// Подключение игроков
io.on('connection', (socket) => {
  console.log('Игрок подключился:', socket.id);

  // Назначаем роль
  if (!players.defender) {
    players.defender = socket.id;
    socket.emit('role', 'defender');
  } else if (!players.attacker) {
    players.attacker = socket.id;
    socket.emit('role', 'attacker');
    // Запускаем игру когда подключились оба
    if (!gameInterval) {
      let lastTime = Date.now();
      gameInterval = setInterval(() => {
        const now = Date.now();
        updateGame((now - lastTime) / 1000);
        lastTime = now;
        broadcastState();
      }, 1000 / 30);
    }
  } else {
    socket.emit('error', 'Игра уже заполнена!');
    return;
  }

  // Обработка действий защитника
  socket.on('plant', (data) => {
    if (socket.id !== players.defender || gameState.gameOver) return;
    if (!PLANT_COSTS[data.type]) return;
    if (gameState.sunPoints < PLANT_COSTS[data.type]) return;
    if (data.row < 0 || data.row >= ROWS || data.col < 0 || data.col >= COLS) return;
    if (gameState.plants.some(p => p.alive && p.row === data.row && p.col === data.col)) return;

    gameState.sunPoints -= PLANT_COSTS[data.type];
    gameState.plants.push({
      type: data.type,
      row: data.row,
      col: data.col,
      x: 150 + data.col * 85 + 42,
      y: 120 + data.row * 90 + 45,
      hp: PLANT_HP[data.type],
      maxHp: PLANT_HP[data.type],
      shootTimer: 0,
      sunTimer: 0,
      alive: true
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

  // Обработка действий атакующего
  socket.on('zombie', (data) => {
    if (socket.id !== players.attacker || gameState.gameOver) return;
    if (!ZOMBIE_COSTS[data.type]) return;
    if (gameState.zombieEnergy < ZOMBIE_COSTS[data.type]) return;
    
    const row = data.row !== undefined ? data.row : Math.floor(Math.random() * ROWS);
    if (row < 0 || row >= ROWS) return;

    gameState.zombieEnergy -= ZOMBIE_COSTS[data.type];
    const stats = ZOMBIE_STATS[data.type];
    gameState.zombies.push({
      type: data.type,
      row: row,
      x: 950 + Math.random() * 50,
      y: 120 + row * 90 + 45,
      hp: stats.hp,
      maxHp: stats.hp,
      speed: stats.speed,
      damage: stats.damage,
      reward: stats.reward,
      attackTimer: 0,
      slowed: false,
      slowTimer: 0,
      alive: true
    });
  });

  socket.on('horde', () => {
    if (socket.id !== players.attacker || gameState.gameOver) return;
    
    const types = ['basic', 'basic', 'cone'];
    types.forEach(type => {
      if (gameState.zombieEnergy < ZOMBIE_COSTS[type]) return;
      gameState.zombieEnergy -= ZOMBIE_COSTS[type];
      const row = Math.floor(Math.random() * ROWS);
      const stats = ZOMBIE_STATS[type];
      gameState.zombies.push({
        type, row,
        x: 950 + Math.random() * 50,
        y: 120 + row * 90 + 45,
        hp: stats.hp,
        maxHp: stats.hp,
        speed: stats.speed,
        damage: stats.damage,
        reward: stats.reward,
        attackTimer: 0,
        slowed: false,
        slowTimer: 0,
        alive: true
      });
    });
  });

  socket.on('restart', () => {
    resetGame();
    clearInterval(gameInterval);
    gameInterval = null;
    let lastTime = Date.now();
    gameInterval = setInterval(() => {
      const now = Date.now();
      updateGame((now - lastTime) / 1000);
      lastTime = now;
      broadcastState();
    }, 1000 / 30);
  });

  socket.on('disconnect', () => {
    console.log('Игрок отключился:', socket.id);
    if (socket.id === players.defender) players.defender = null;
    if (socket.id === players.attacker) players.attacker = null;
    if (!players.defender || !players.attacker) {
      clearInterval(gameInterval);
      gameInterval = null;
      gameState.gameOver = true;
    }
  });
});

// Запуск
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`🎮 Сервер запущен на порту ${PORT}`);
});