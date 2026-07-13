/**
 * server.js
 * Core Express framework bootstrap file. Sets up the template engine,
 * static asset pipelines, global middleware, and mounts route controllers.
 */

const express = require('express');
const path = require('path');
const weatherRouter = require('./routes/weather');

const app = express();
const PORT = process.env.PORT || 3000;

// 1. Configure the View Engine
// Set EJS as our server-side templating engine and point it to the /views directory
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// 2. Serve Static Assets
// Enable the serving of plain files (CSS, images, client JS) directly from the /public directory
app.use(express.static(path.join(__dirname, 'public')));

// 3. Mount Application Routers
// Route all root-level requests through our dedicated weather sub-router
app.use('/', weatherRouter);

// 4. Fallback 404 Route Handler
// If a request hits none of the designated endpoints above, generate a structured 404 response
app.use((req, res, next) => {
    const error = new Error(`Resource Not Found - ${req.originalUrl}`);
    error.status = 404;
    next(error); // Forward the error to our centralized processing pipeline
});

// 5. Centralized Error-Handling Middleware
// Catches explicit network drops, missing assets, and unhandled execution blocks safely
app.use((err, req, res, next) => {
    const statusCode = err.status || 500;
    console.error(`[SERVER ERROR] [${statusCode}]:`, err.message);

    // Pass a uniform payload to EJS to ensure the UI handles crashes gracefully
    res.status(statusCode).render('index', {
        weather: null,
        error: `Something went wrong on our end (${err.message || 'Internal Server Error'}). Please try again later.`,
        city: req.query.city || ''
    });
});

// 6. Bind Server Instance to System Port
app.listen(PORT, () => {
    console.log(`[SERVER OK] Application spinning up at: http://localhost:${PORT}`);
});
