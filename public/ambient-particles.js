class ParticleEngine {
    constructor(canvasId) {
        this.canvas = document.getElementById(canvasId);
        if (!this.canvas) return;

        this.ctx = this.canvas.getContext('2d', { alpha: true });
        this.particles = [];
        this.comets = [];
        this.animationId = null;

        this.config = {
            enabled: true,
            count: 80,
            speed: 0.2,
            connectLines: true,
            lineDistance: 150,
            maxSize: 1.2,
            comets: true
        };

        this.resize = this.resize.bind(this);
        this.animate = this.animate.bind(this);
        this.handleVisibility = this.handleVisibility.bind(this);

        window.addEventListener('resize', this.resize);
        document.addEventListener('visibilitychange', this.handleVisibility);

        this.resize();
        this.initParticles();
    }

    updateConfig(newConfig) {
        const oldCount = this.config.count;
        this.config = { ...this.config, ...newConfig };

        if (!this.config.enabled) {
            this.stop();
            this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
            return;
        }

        if (newConfig.count !== undefined && oldCount !== newConfig.count) {
            this.initParticles();
        }

        if (this.config.enabled && !this.animationId) {
            this.animate();
        }
    }

    initParticles() {
        this.particles = [];
        this.comets = [];
        for (let i = 0; i < this.config.count; i++) {
            this.particles.push(this.createParticle());
        }
    }

    createParticle() {
        const angle = Math.random() * Math.PI * 2;
        return {
            x: Math.random() * this.canvas.width,
            y: Math.random() * this.canvas.height,
            dirX: Math.cos(angle),
            dirY: Math.sin(angle),
            baseSize: Math.random() * 0.8 + 0.2,
            opacity: Math.random() * 0.5 + 0.1
        };
    }

    createComet() {
        const angle = (Math.PI / 4) + (Math.random() * 0.15 - 0.075);
        const speed = Math.random() * 8 + 12; 

        const startY = -100 - Math.random() * 100;
        const startX = (Math.random() * (this.canvas.width * 0.8)) - 200;

        return {
            x: startX,
            y: startY,
            vx: Math.cos(angle) * speed,
            vy: Math.sin(angle) * speed,
            length: Math.random() * 120 + 80,
            thickness: Math.random() * 1.0 + 0.8,
            opacity: Math.random() * 0.3 + 0.5
        };
    }

    stop() {
        if (this.animationId) {
            cancelAnimationFrame(this.animationId);
            this.animationId = null;
        }
    }

    resize() {
        this.canvas.width = window.innerWidth;
        this.canvas.height = window.innerHeight;
        if (this.config.enabled && this.particles.length > 0) {
            this.initParticles();
        }
    }

    handleVisibility() {
        if (document.hidden) {
            this.stop();
        } else if (this.config.enabled) {
            this.animate();
        }
    }

    animate() {
        this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

        // 1. Обычные частицы
        for (let i = 0; i < this.particles.length; i++) {
            let p = this.particles[i];

            p.x += p.dirX * this.config.speed;
            p.y += p.dirY * this.config.speed;

            if (p.x < 0) p.x = this.canvas.width;
            if (p.x > this.canvas.width) p.x = 0;
            if (p.y < 0) p.y = this.canvas.height;
            if (p.y > this.canvas.height) p.y = 0;

            const currentSize = p.baseSize * this.config.maxSize;

            this.ctx.beginPath();
            this.ctx.arc(p.x, p.y, currentSize, 0, Math.PI * 2);
            this.ctx.fillStyle = `rgba(255, 255, 255, ${p.opacity})`;
            this.ctx.fill();

            if (this.config.connectLines) {
                for (let j = i + 1; j < this.particles.length; j++) {
                    let p2 = this.particles[j];
                    let dx = p.x - p2.x;
                    let dy = p.y - p2.y;
                    let dist = Math.sqrt(dx * dx + dy * dy);

                    if (dist < this.config.lineDistance) {
                        this.ctx.beginPath();
                        this.ctx.moveTo(p.x, p.y);
                        this.ctx.lineTo(p2.x, p2.y);
                        let lineOpacity = (1 - dist / this.config.lineDistance) * 0.15;
                        this.ctx.strokeStyle = `rgba(255, 255, 255, ${lineOpacity})`;
                        this.ctx.lineWidth = 0.5;
                        this.ctx.stroke();
                    }
                }
            }
        }

        // 2. Редкое создание комет (шанс 0.1% в кадр = ~1 раз в 16 секунд при 60fps)
        if (this.config.comets && Math.random() < 0.001) {
            this.comets.push(this.createComet());
        }

        // 3. Отрисовка летящих комет
        for (let i = this.comets.length - 1; i >= 0; i--) {
            let c = this.comets[i];
            c.x += c.vx;
            c.y += c.vy;

            if (c.x > this.canvas.width + c.length || c.y > this.canvas.height + c.length) {
                this.comets.splice(i, 1);
                continue;
            }

            const speedFactor = Math.sqrt(c.vx * c.vx + c.vy * c.vy);
            const tailX = c.x - (c.vx / speedFactor) * c.length;
            const tailY = c.y - (c.vy / speedFactor) * c.length;

            const grad = this.ctx.createLinearGradient(c.x, c.y, tailX, tailY);
            grad.addColorStop(0, `rgba(255, 255, 255, ${c.opacity})`);
            grad.addColorStop(1, `rgba(255, 255, 255, 0)`);

            this.ctx.beginPath();
            this.ctx.moveTo(c.x, c.y);
            this.ctx.lineTo(tailX, tailY);
            this.ctx.strokeStyle = grad;
            this.ctx.lineWidth = c.thickness;
            this.ctx.stroke();

            this.ctx.beginPath();
            this.ctx.arc(c.x, c.y, c.thickness * 1.5, 0, Math.PI * 2);
            this.ctx.fillStyle = `rgba(255, 255, 255, ${c.opacity + 0.3})`;
            this.ctx.fill();
        }

        this.animationId = requestAnimationFrame(this.animate);
    }
}

window.addEventListener('DOMContentLoaded', () => {
    window.AmbientBG = new ParticleEngine('particles-canvas');
});
