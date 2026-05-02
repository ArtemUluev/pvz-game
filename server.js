const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

app.use(express.static('public'));

const ROWS = 5, COLS = 9;
const FIELD_START_X = 150, CELL_W = 85, CELL_H = 90, FIELD_TOP_Y = 120;
const FIELD_END_X = FIELD_START_X + COLS * CELL_W;

const ALL_PLANTS = {
  sunflower: { name:'Подсолнух', cost:50, hp:80, sunInterval:10, cooldown:10 },
  peashooter: { name:'Горохострел', cost:100, hp:80, damage:25, shootInterval:1.5, cooldown:2 },
  snowpea: { name:'Ледяной горох', cost:175, hp:80, damage:20, shootInterval:1.7, slow:true, cooldown:3 },
  walnut: { name:'Орех', cost:50, hp:600, cooldown:8 },
  cherrybomb: { name:'Вишня-бомба', cost:150, hp:1, explosive:true, cooldown:15 },
  repeater: { name:'Повторюха', cost:200, hp:80, damage:25, shootInterval:0.8, doubleShot:true, cooldown:2 },
  torchwood: { name:'Факел', cost:175, hp:200, fireBoost:true, cooldown:5 },
  potatomine: { name:'Картофель-мина', cost:25, hp:1, explosive:true, armTime:8, cooldown:12 },
  chomper: { name:'Венерина', cost:150, hp:100, chompCooldown:15, cooldown:8 },
  starfruit: { name:'Звездоплод', cost:125, hp:80, damage:15, shootInterval:1.2, starShots:true, cooldown:2 },
  garlic: { name:'Чеснок', cost:50, hp:200, redirect:true, cooldown:15 },
  cattail: { name:'Рогоз', cost:225, hp:80, damage:15, shootInterval:0.6, homing:true, cooldown:3 }
};

const ALL_ZOMBIES = {
  basic: { name:'Обычный', hp:100, speed:28, damage:25, reward:25, energyReward:15, cost:30, tier:0 },
  cone: { name:'Конусный', hp:200, speed:22, damage:25, reward:40, energyReward:25, cost:50, tier:1 },
  bucket: { name:'Ведёрный', hp:400, speed:18, damage:35, reward:60, energyReward:35, cost:80, tier:2 },
  runner: { name:'Бегун', hp:80, speed:50, damage:15, reward:30, energyReward:20, cost:40, tier:3 },
  gargantuar: { name:'Гаргантюа', hp:1000, speed:14, damage:80, reward:150, energyReward:80, cost:150, tier:4 },
  imp: { name:'Чертёнок', hp:60, speed:35, damage:10, reward:15, energyReward:10, cost:20, tier:0 },
  triple_basic: { name:'Трио', hp:80, speed:25, damage:20, reward:20, energyReward:12, cost:55, tier:0, count:3 },
  door: { name:'С дверью', hp:150, doorHp:150, speed:22, damage:25, reward:45, energyReward:30, cost:60, tier:1 },
  double_cone: { name:'Два конусных', hp:150, speed:20, damage:20, reward:35, energyReward:22, cost:70, tier:1, count:2 },
  shooter: { name:'Стрелок', hp:150, speed:18, damage:10, rangedDamage:15, shootRange:200, reward:70, energyReward:40, cost:90, tier:2 },
  double_bucket: { name:'Два ведра', hp:300, speed:16, damage:30, reward:50, energyReward:30, cost:100, tier:2, count:2 },
  healer: { name:'Доктор', hp:100, speed:20, damage:5, healAmount:15, healRange:120, reward:40, energyReward:25, cost:55, tier:3 },
  jumper: { name:'Прыгун', hp:90, speed:45, damage:18, jumpRange:150, reward:35, energyReward:22, cost:45, tier:3 },
  king: { name:'Король', hp:800, speed:12, damage:60, spawnImps:true, impCount:3, reward:200, energyReward:100, cost:180, tier:4 },
  giant: { name:'Гигант', hp:1200, speed:10, damage:100, reward:180, energyReward:90, cost:160, tier:4 }
};

let players = { player1: null, player2: null, defender: null, attacker: null };
let player1Plants = ['sunflower','peashooter','snowpea','walnut','cherrybomb'];
let player2Plants = ['sunflower','peashooter','snowpea','walnut','cherrybomb'];
let player1Zombies = ['basic','cone','bucket','runner','gargantuar'];
let player2Zombies = ['basic','cone','bucket','runner','gargantuar'];

let game = {
  mode: null, round: 0, phase: 'lobby',
  plants: [], zombies: [], projectiles: [], sunDrops: [], lawnmowers: Array(ROWS).fill(true),
  sunPoints: 150, zombieEnergy: 60, maxEnergy: 300,
  prepTimer: 15, elapsedTime: 0, spawnLocked: true,
  unlockedTiers: 0, zombieKillCount: 0, plantCooldowns: {},
  score1: 0, score2: 0, roundsWon: [0,0], matchScores: [],
  gameOver: false, winner: null, hordeTimer: 120, lastUpdate: Date.now()
};

function resetRound() {
  game.plants = []; game.zombies = []; game.projectiles = []; game.sunDrops = [];
  game.lawnmowers = Array(ROWS).fill(true);
  game.sunPoints = 150; game.zombieEnergy = 60; game.maxEnergy = 300;
  game.prepTimer = 15; game.elapsedTime = 0; game.spawnLocked = true;
  game.unlockedTiers = 0; game.zombieKillCount = 0; game.plantCooldowns = {};
  game.score1 = 0; game.score2 = 0; game.gameOver = false; game.winner = null;
  game.hordeTimer = 120; game.lastUpdate = Date.now();
}

function getPlantStats(type) { return ALL_PLANTS[type]; }
function getZombieStats(type) { return ALL_ZOMBIES[type]; }

function unlockTiers() {
  const tier = Math.floor(game.zombieKillCount / 25);
  if (tier > game.unlockedTiers && tier <= 4) {
    game.unlockedTiers = tier;
    io.emit('message', `🔓 Тир ${tier+1}/5 открыт!`);
  }
}

function endRound(winner) {
  game.phase = 'result'; game.gameOver = true; game.winner = winner;
  game.matchScores.push({ round: game.round, time: game.elapsedTime, winner });
  if (game.mode === 'versus' && game.round >= 3) game.phase = 'gameover';
}

function switchSides() {
  [players.defender, players.attacker] = [players.attacker, players.defender];
  io.to(players.defender).emit('role', 'defender');
  io.to(players.attacker).emit('role', 'attacker');
}

// Игровой цикл
function update() {
  const now = Date.now();
  const dt = Math.min(0.2, (now - game.lastUpdate) / 1000);
  game.lastUpdate = now;
  
  if (game.phase === 'prep') {
    game.prepTimer -= dt;
    if (game.prepTimer <= 0) { game.phase = 'playing'; game.spawnLocked = false; }
    return;
  }
  if (game.phase !== 'playing') return;
  
  game.elapsedTime += dt;
  game.zombieEnergy = Math.min(game.maxEnergy, game.zombieEnergy + 5*dt);
  unlockTiers();
  
  game.hordeTimer -= dt;
  if (game.hordeTimer <= 0 && game.elapsedTime >= 30) {
    spawnAutoHorde();
    game.hordeTimer = 90 + Math.random()*60;
  }
  
  // кулдауны
  Object.keys(game.plantCooldowns).forEach(k => game.plantCooldowns[k] = Math.max(0, game.plantCooldowns[k]-dt));
  
  // растения
  game.plants.forEach(p => {
    if (!p.alive) return;
    p.shootTimer -= dt; p.specialTimer -= dt;
    const s = getPlantStats(p.type);
    if (s.sunInterval) {
      p.sunTimer -= dt;
      if (p.sunTimer <= 0) {
        game.sunDrops.push({ x:p.x+(Math.random()-0.5)*40, y:p.y-10, alive:true, value:25 });
        p.sunTimer = s.sunInterval + Math.random()*4;
      }
    }
    if (s.shootInterval && p.shootTimer <= 0) {
      if (s.homing) {
        const target = game.zombies.find(z=>z.alive);
        if (target) game.projectiles.push({ x:p.x+20, y:p.y, row:target.row, homing:true, damage:s.damage, alive:true });
      } else if (s.starShots) {
        for (let off=-1; off<=1; off++) {
          const r = p.row+off;
          if (r>=0 && r<ROWS) game.projectiles.push({ x:p.x+20, y:120+r*90+45, row:r, damage:s.damage, alive:true });
        }
      } else {
        if (game.zombies.some(z=>z.row===p.row && z.alive && z.x>p.x)) {
          game.projectiles.push({ x:p.x+20, y:p.y, row:p.row, damage:s.damage, slow:s.slow, fire:s.fireBoost, alive:true });
          if (s.doubleShot) setTimeout(()=>{ if(p.alive) game.projectiles.push({ x:p.x+20, y:p.y, row:p.row, damage:s.damage, alive:true }); },150);
        }
      }
      p.shootTimer = s.shootInterval;
    }
    if (s.chompCooldown && p.specialTimer <= 0) {
      const z = game.zombies.find(z=>z.row===p.row && z.alive && Math.abs(z.x-p.x)<45);
      if (z) { z.hp=0; p.specialTimer=s.chompCooldown; }
    }
    if (s.explosive && p.plantTime && now-p.plantTime > (s.armTime||0.6)*1000) {
      game.zombies.forEach(z=>{ if(z.alive && Math.hypot(z.x-p.x,z.y-p.y)<160) z.hp-=180; });
      p.alive=false;
    }
    if (p.hp<=0) p.alive=false;
  });
  
  // зомби
  game.zombies.forEach(z => {
    if (!z.alive) return;
    if (z.rangedDamage) { z.shootTimer-=dt; if(z.shootTimer<=0 && z.x<FIELD_END_X){ const t=game.plants.find(p=>p.alive&&p.row===z.row&&Math.abs(p.x-z.x)<z.shootRange); if(t){ t.hp-=z.rangedDamage; z.shootTimer=2; } } }
    if (z.healAmount) { z.healTimer-=dt; if(z.healTimer<=0){ game.zombies.forEach(zz=>{ if(zz.alive&&zz!==z&&Math.hypot(zz.x-z.x,zz.y-z.y)<z.healRange) zz.hp=Math.min(zz.maxHp,zz.hp+z.healAmount); }); z.healTimer=3; } }
    if (z.jumpRange && !z.jumped) { const t=game.plants.find(p=>p.alive&&p.row===z.row&&z.x-p.x<z.jumpRange&&z.x-p.x>40); if(t){ z.x=t.x-20; z.jumped=true; } }
    
    let block = game.plants.find(p=>p.alive && p.row===z.row && Math.abs(z.x-p.x)<45);
    if (block) {
      z.attackTimer-=dt;
      if (z.attackTimer<=0) {
        if (z.doorHp>0) z.doorHp -= 50; else { block.hp-=z.damage; if(block.type==='garlic'){ z.row=(z.row+1)%ROWS; z.y=120+z.row*90+45; } }
        z.attackTimer=0.7;
        if (block.hp<=0) { block.alive=false; game.zombieEnergy=Math.min(game.maxEnergy, game.zombieEnergy+20); }
      }
    } else {
      z.x -= (z.slowed?z.speed*0.4:z.speed)*dt;
    }
    if (z.x<FIELD_START_X && game.lawnmowers[z.row]) { game.lawnmowers[z.row]=false; game.zombies.forEach(zz=>{ if(zz.row===z.row) zz.alive=false; }); }
    if (z.x<FIELD_START_X-60 && !game.lawnmowers[z.row]) { z.alive=false; game.score2++; if(game.score2>=5) endRound('attacker'); }
    if (z.hp<=0) {
      z.alive=false; game.score1++; game.zombieKillCount++;
      game.sunPoints+=z.reward; game.zombieEnergy=Math.min(game.maxEnergy, game.zombieEnergy+z.energyReward);
      if (z.spawnImps) for(let i=0;i<z.impCount;i++) game.zombies.push({ type:'imp',row:z.row, x:z.x+Math.random()*40, y:z.y+(Math.random()-0.5)*30, hp:60,maxHp:60,speed:35,damage:10,reward:15,energyReward:10,alive:true });
    }
  });
  
  // снаряды
  game.projectiles.forEach(p => {
    if (!p.alive) return;
    p.x += 400*dt;
    game.zombies.forEach(z => {
      if (!z.alive || (!p.homing && z.row!==p.row)) return;
      if (Math.abs(p.x-z.x)<22) {
        if (z.doorHp>0) z.doorHp-=p.damage; else z.hp-=p.damage;
        if (p.fire) z.hp-=10;
        if (p.slow) z.slowed=true;
        p.alive=false;
      }
    });
    if (p.x>FIELD_END_X+300) p.alive=false;
  });
  
  if (Math.random()<dt*0.1) game.sunDrops.push({ x:FIELD_START_X+Math.random()*COLS*CELL_W, y:90, alive:true, value:25 });
  
  game.plants = game.plants.filter(p=>p.alive);
  game.zombies = game.zombies.filter(z=>z.alive);
  game.projectiles = game.projectiles.filter(p=>p.alive);
  game.sunDrops = game.sunDrops.filter(s=>s.alive);
}

function spawnAutoHorde() {
  const count = Math.min(5+Math.floor(game.elapsedTime/20), 20);
  const list = (game.round%2===0 ? player2Zombies : player1Zombies).filter(t => getZombieStats(t).tier <= game.unlockedTiers);
  for (let i=0; i<count; i++) {
    const type = list[Math.floor(Math.random()*list.length)];
    const s = getZombieStats(type);
    for (let j=0; j<(s.count||1); j++) {
      game.zombies.push({
        type, row: Math.floor(Math.random()*ROWS), x: FIELD_END_X+20, y: 120+Math.floor(Math.random()*ROWS)*90+45,
        hp:s.hp, maxHp:s.hp, speed:s.speed, damage:s.damage, reward:s.reward, energyReward:s.energyReward,
        doorHp:s.doorHp||0, rangedDamage:s.rangedDamage||0, shootRange:s.shootRange||0,
        healAmount:s.healAmount||0, healRange:s.healRange||0, jumpRange:s.jumpRange||0,
        spawnImps:s.spawnImps||false, impCount:s.impCount||0, alive:true
      });
    }
  }
}

function broadcast() {
  io.emit('state', {
    mode: game.mode, round: game.round, phase: game.phase,
    plants: game.plants.filter(p=>p.alive).map(p=>({ type:p.type, row:p.row, col:p.col, x:p.x, y:p.y, hp:p.hp, maxHp:p.maxHp })),
    zombies: game.zombies.filter(z=>z.alive).map(z=>({ type:z.type, row:z.row, x:z.x, y:z.y, hp:z.hp, maxHp:z.maxHp, slowed:z.slowed, doorHp:z.doorHp||0 })),
    projectiles: game.projectiles.filter(p=>p.alive).map(p=>({ x:p.x, y:p.y, row:p.row, fire:p.fire, homing:p.homing })),
    sunDrops: game.sunDrops.filter(s=>s.alive).map((s,i)=>({ id:i, x:s.x, y:s.y })),
    lawnmowers: game.lawnmowers, sunPoints: Math.floor(game.sunPoints),
    zombieEnergy: Math.floor(game.zombieEnergy), spawnLocked: game.spawnLocked,
    prepTimer: Math.ceil(game.prepTimer), elapsedTime: game.elapsedTime,
    unlockedTiers: game.unlockedTiers, zombieKillCount: game.zombieKillCount,
    plantCooldowns: game.plantCooldowns, score1: game.score1, score2: game.score2,
    roundsWon: game.roundsWon, gameOver: game.gameOver, winner: game.winner,
    hordeTimer: Math.ceil(game.hordeTimer),
    player1Plants, player2Plants, player1Zombies, player2Zombies
  });
}

setInterval(() => { if (game.phase!=='lobby' && game.phase!=='customize') update(); broadcast(); }, 1000/30);

io.on('connection', socket => {
  if (!players.player1) { players.player1 = socket.id; players.defender = socket.id; socket.emit('role','defender'); socket.emit('isHost', true); }
  else if (!players.player2) { players.player2 = socket.id; players.attacker = socket.id; socket.emit('role','attacker'); }
  else { socket.emit('error','Полно'); socket.disconnect(); return; }
  
  socket.on('selectMode', mode => { if(socket.id===players.player1 && game.phase==='lobby'){ game.mode=mode; game.phase='customize'; io.emit('message','Настройте войска!'); } });
  socket.on('setPlants', p => { if(socket.id===players.player1) player1Plants=p; else player2Plants=p; });
  socket.on('setZombies', z => { if(socket.id===players.player1) player1Zombies=z; else player2Zombies=z; });
  socket.on('startGame', () => { if(game.phase==='customize'){ game.round=0; resetRound(); game.phase='prep'; io.emit('message','Приготовьтесь!'); } });
  socket.on('plant', data => {
    if (socket.id!==players.defender || game.phase!=='playing') return;
    const list = game.round%2===0 ? player1Plants : player2Plants;
    if (!list.includes(data.type)) return;
    const s = getPlantStats(data.type);
    if (game.sunPoints < s.cost || (game.plantCooldowns[data.type]||0)>0) return;
    if (game.plants.some(p=>p.alive && p.row===data.row && p.col===data.col)) return;
    game.sunPoints -= s.cost;
    game.plantCooldowns[data.type] = s.cooldown;
    game.plants.push({ type:data.type, row:data.row, col:data.col, x:FIELD_START_X+data.col*CELL_W+CELL_W/2, y:FIELD_TOP_Y+data.row*CELL_H+CELL_H/2, hp:s.hp, maxHp:s.hp, shootTimer:0, sunTimer:0, specialTimer:0, plantTime:Date.now(), alive:true });
  });
  socket.on('collect', data => { const s=game.sunDrops[data.id]; if(s?.alive){ game.sunPoints+=25; s.alive=false; } });
  socket.on('zombie', data => {
    if (socket.id!==players.attacker || game.phase!=='playing' || game.spawnLocked) return;
    const list = game.round%2===0 ? player2Zombies : player1Zombies;
    if (!list.includes(data.type)) return;
    const s = getZombieStats(data.type);
    if (s.tier > game.unlockedTiers || game.zombieEnergy < s.cost) return;
    game.zombieEnergy -= s.cost;
    for (let i=0; i<(s.count||1); i++) game.zombies.push({ type:data.type, row:data.row, x:FIELD_END_X+i*20, y:FIELD_TOP_Y+data.row*CELL_H+CELL_H/2, hp:s.hp, maxHp:s.hp, speed:s.speed, damage:s.damage, reward:s.reward, energyReward:s.energyReward, doorHp:s.doorHp||0, rangedDamage:s.rangedDamage||0, shootRange:s.shootRange||0, healAmount:s.healAmount||0, healRange:s.healRange||0, jumpRange:s.jumpRange||0, spawnImps:s.spawnImps||false, impCount:s.impCount||0, alive:true });
  });
  socket.on('nextRound', () => { if(game.mode==='versus' && game.phase==='result' && game.round<3){ game.round++; switchSides(); resetRound(); game.phase='prep'; } });
  socket.on('restart', () => {
    game = { mode:null, round:0, phase:'lobby', plants:[], zombies:[], projectiles:[], sunDrops:[], lawnmowers:Array(ROWS).fill(true), sunPoints:150, zombieEnergy:60, maxEnergy:300, prepTimer:15, elapsedTime:0, spawnLocked:true, unlockedTiers:0, zombieKillCount:0, plantCooldowns:{}, score1:0, score2:0, roundsWon:[0,0], matchScores:[], gameOver:false, winner:null, hordeTimer:120, lastUpdate:Date.now() };
    players.defender = players.player1; players.attacker = players.player2;
    if (players.player1) io.to(players.player1).emit('role','defender');
    if (players.player2) io.to(players.player2).emit('role','attacker');
    io.emit('message','Перезапуск');
  });
  socket.on('disconnect', () => {
    if (socket.id===players.player1) players.player1=null;
    if (socket.id===players.player2) players.player2=null;
    if (socket.id===players.defender) players.defender=null;
    if (socket.id===players.attacker) players.attacker=null;
    game.phase='lobby';
  });
});

server.listen(process.env.PORT||3000, () => console.log('Сервер v4.0'));
