import express from 'express';
import cors from 'cors';
import path from 'path';
import { config } from './config/env';

import authRoutes from './routes/auth.routes';
import projectRoutes from './routes/project.routes';
import deployRoutes from './routes/deploy.routes';
import logsRoutes from './routes/logs.routes';
import userRoutes from './routes/user.routes';
import systemRoutes from './routes/system.routes';

import http from 'http';
import { Server, Socket } from 'socket.io';
import { initSocket } from './services/queue.service';
import { startWafLogWatcher } from './services/waf.service';

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: '*', // Allow all origins for now
    methods: ['GET', 'POST'],
    credentials: true
  },
  path: '/socket.io',
  transports: ['websocket', 'polling'],
  allowEIO3: true
});

initSocket(io);

io.on('connection', (socket: Socket) => {
  console.log('Client connected', socket.id);
  
  socket.on('join-project', (projectId: string) => {
    socket.join(`project-${projectId}`);
    console.log(`Socket ${socket.id} joined project-${projectId}`);
  });

  socket.on('disconnect', () => {
    console.log('Client disconnected', socket.id);
  });
});

app.use(cors());
app.use(express.json());

// Routes
app.use('/auth', authRoutes);
app.use('/projects', projectRoutes);
app.use('/', deployRoutes); // /deploy/:projectId, /restart/:projectId, /stop/:projectId
app.use('/logs', logsRoutes);
app.use('/users', userRoutes);
app.use('/system', systemRoutes);

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

// Root path to prevent 404
app.get('/', (req, res) => {
  res.json({ status: 'Papuyu API is running' });
});

server.listen(config.port, () => {
  console.log(`Server running on port ${config.port}`);
  
  // Start background workers
  startWafLogWatcher();
});
