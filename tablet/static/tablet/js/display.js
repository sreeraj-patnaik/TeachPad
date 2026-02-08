/**
 * Display: fullscreen 16:9 board. Multiple boards (slides); show current board.
 */
(function () {
    'use strict';

    const WORLD_W = 1920;
    const WORLD_H = 1080;
    const NUM_BOARDS = 10;
    const ERASER_MIN_SIZE = 12;

    const canvas = document.getElementById('canvas');
    const ctx = canvas.getContext('2d');

    const strokesByBoard = [];
    const currentStrokeByBoard = [];
    let currentDisplayBoard = 0;

    for (let i = 0; i < NUM_BOARDS; i++) {
        strokesByBoard.push([]);
        currentStrokeByBoard.push(null);
    }

    let scale = 1;
    let offsetX = 0;
    let offsetY = 0;

    const wsScheme = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = wsScheme + '//' + window.location.host + '/ws/draw/';
    let socket = null;

    function connect() {
        socket = new WebSocket(wsUrl);
        socket.onmessage = function (event) {
            try {
                const msg = JSON.parse(event.data);
                if (msg.type === 'set_board') {
                    currentDisplayBoard = Math.max(0, Math.min(NUM_BOARDS - 1, parseInt(msg.board, 10) || 0));
                    return;
                }
                if (msg.type !== 'draw') return;
                const b = Math.max(0, Math.min(NUM_BOARDS - 1, parseInt(msg.board, 10) || 0));
                const strokes = strokesByBoard[b];
                let currentStroke = currentStrokeByBoard[b];
                const x = clampWorldX(msg.x);
                const y = clampWorldY(msg.y);
                const drawing = msg.drawing === true;
                const strokeTool = msg.tool || 'pen';
                const strokeColor = msg.color || '#000000';
                const strokeSize = strokeTool === 'eraser' ? Math.max(ERASER_MIN_SIZE, msg.size || 4) : Math.max(1, msg.size || 4);
                if (drawing) {
                    if (!currentStroke || currentStroke.tool !== strokeTool || currentStroke.color !== strokeColor || currentStroke.size !== strokeSize) {
                        if (currentStroke && currentStroke.points.length > 0) strokes.push(currentStroke);
                        currentStroke = { tool: strokeTool, color: strokeColor, size: strokeSize, points: [] };
                    }
                    currentStroke.points.push({ x: x, y: y });
                    currentStrokeByBoard[b] = currentStroke;
                } else {
                    if (currentStroke && currentStroke.points.length > 0) strokes.push(currentStroke);
                    currentStrokeByBoard[b] = null;
                }
            } catch (_) {}
        };
        socket.onclose = function () { setTimeout(connect, 2000); };
    }
    connect();

    function resize() {
        const w = window.innerWidth;
        const h = window.innerHeight;
        const dpr = window.devicePixelRatio || 1;
        canvas.width = w * dpr;
        canvas.height = h * dpr;
        canvas.style.width = w + 'px';
        canvas.style.height = h + 'px';
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.scale(dpr, dpr);

        const fitScale = Math.min(w / WORLD_W, h / WORLD_H);
        scale = fitScale;
        offsetX = (w - WORLD_W * scale) / 2;
        offsetY = (h - WORLD_H * scale) / 2;
    }
    window.addEventListener('resize', resize);
    resize();

    function drawBoardBackground() {
        ctx.fillStyle = '#fff';
        ctx.fillRect(offsetX, offsetY, WORLD_W * scale, WORLD_H * scale);
        ctx.strokeStyle = '#e0e0e0';
        ctx.lineWidth = 1;
        ctx.strokeRect(offsetX, offsetY, WORLD_W * scale, WORLD_H * scale);
    }

    function worldToDisplay(x, y) {
        return { x: offsetX + x * scale, y: offsetY + y * scale };
    }

    function worldSizeToDisplay(s) {
        return Math.max(1, s * scale);
    }

    function clampWorldX(x) { return Math.max(0, Math.min(WORLD_W, Number(x) || 0)); }
    function clampWorldY(y) { return Math.max(0, Math.min(WORLD_H, Number(y) || 0)); }

    function drawStrokesForBoard(boardIndex) {
        const strokes = strokesByBoard[boardIndex];
        for (let i = 0; i < strokes.length; i++) {
            const s = strokes[i];
            const pts = s.points;
            if (pts.length < 2) continue;
            if (s.tool === 'eraser') {
                ctx.globalCompositeOperation = 'destination-out';
                ctx.strokeStyle = 'rgba(0,0,0,1)';
            } else {
                ctx.globalCompositeOperation = 'source-over';
                ctx.strokeStyle = s.color;
            }
            ctx.lineWidth = worldSizeToDisplay(s.size);
            ctx.lineCap = 'round';
            ctx.lineJoin = 'round';
            ctx.beginPath();
            const p0 = worldToDisplay(pts[0].x, pts[0].y);
            ctx.moveTo(p0.x, p0.y);
            for (let j = 1; j < pts.length; j++) {
                const p = worldToDisplay(pts[j].x, pts[j].y);
                ctx.lineTo(p.x, p.y);
            }
            ctx.stroke();
        }
        ctx.globalCompositeOperation = 'source-over';

        const currentStroke = currentStrokeByBoard[boardIndex];
        if (currentStroke && currentStroke.points.length > 0) {
            const s = currentStroke;
            const pts = s.points;
            if (s.tool === 'eraser') {
                ctx.globalCompositeOperation = 'destination-out';
                ctx.strokeStyle = 'rgba(0,0,0,1)';
            } else {
                ctx.globalCompositeOperation = 'source-over';
                ctx.strokeStyle = s.color;
            }
            ctx.lineWidth = worldSizeToDisplay(s.size);
            ctx.lineCap = 'round';
            ctx.lineJoin = 'round';
            ctx.beginPath();
            const p0 = worldToDisplay(pts[0].x, pts[0].y);
            ctx.moveTo(p0.x, p0.y);
            for (let j = 1; j < pts.length; j++) {
                const p = worldToDisplay(pts[j].x, pts[j].y);
                ctx.lineTo(p.x, p.y);
            }
            ctx.stroke();
            ctx.globalCompositeOperation = 'source-over';
        }
    }

    function tick() {
        drawBoardBackground();
        drawStrokesForBoard(currentDisplayBoard);
        requestAnimationFrame(tick);
    }
    requestAnimationFrame(tick);
})();
