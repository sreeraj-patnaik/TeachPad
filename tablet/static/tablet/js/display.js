/**
 * Display: fullscreen 16:9 board. World is fixed 1920×1080; scale to fit.
 * Stroke size in world units so thickness is consistent regardless of phone zoom.
 */

(function () {
    'use strict';

    const WORLD_W = 1920;
    const WORLD_H = 1080;

    const canvas = document.getElementById('canvas');
    const ctx = canvas.getContext('2d');

    const queue = [];
    let lastPoint = null;
    let backgroundDrawn = false;

    // After resize: scale and offset so world [0,WORLD_W] x [0,WORLD_H] fits (letterbox)
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
                if (msg.type === 'draw') queue.push(msg);
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
        backgroundDrawn = false;
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

    // Transform world coords to display pixels (used for drawing)
    function worldToDisplay(x, y) {
        return {
            x: offsetX + x * scale,
            y: offsetY + y * scale,
        };
    }

    function worldSizeToDisplay(s) {
        return Math.max(1, s * scale);
    }

    function clampWorldX(x) { return Math.max(0, Math.min(WORLD_W, Number(x) || 0)); }
    function clampWorldY(y) { return Math.max(0, Math.min(WORLD_H, Number(y) || 0)); }

    function applyMessage(msg) {
        const x = clampWorldX(msg.x);
        const y = clampWorldY(msg.y);
        const drawing = msg.drawing === true;
        const tool = msg.tool || 'pen';
        const color = msg.color || '#000000';
        const size = Math.max(1, msg.size || 4);
        const dSize = worldSizeToDisplay(size);

        if (tool === 'eraser') {
            ctx.globalCompositeOperation = 'destination-out';
            ctx.strokeStyle = 'rgba(0,0,0,1)';
        } else {
            ctx.globalCompositeOperation = 'source-over';
            ctx.strokeStyle = color;
        }
        ctx.lineWidth = dSize;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';

        const p = worldToDisplay(x, y);

        if (drawing && lastPoint) {
            const p0 = worldToDisplay(lastPoint.x, lastPoint.y);
            ctx.beginPath();
            ctx.moveTo(p0.x, p0.y);
            ctx.lineTo(p.x, p.y);
            ctx.stroke();
        } else if (drawing) {
            ctx.beginPath();
            ctx.arc(p.x, p.y, dSize / 2, 0, Math.PI * 2);
            if (tool === 'eraser') {
                ctx.globalCompositeOperation = 'destination-out';
                ctx.fillStyle = 'rgba(0,0,0,1)';
            } else {
                ctx.globalCompositeOperation = 'source-over';
                ctx.fillStyle = color;
            }
            ctx.fill();
            ctx.globalCompositeOperation = 'source-over';
        }

        if (drawing) {
            lastPoint = { x, y, tool, color, size };
        } else {
            lastPoint = null;
        }
    }

    function tick() {
        if (!backgroundDrawn) {
            drawBoardBackground();
            backgroundDrawn = true;
        }
        while (queue.length > 0) applyMessage(queue.shift());
        requestAnimationFrame(tick);
    }
    requestAnimationFrame(tick);
})();
