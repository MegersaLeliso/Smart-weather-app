/**
 * routes/push.js
 * Web Push subscription endpoints for Pack & Wear alarms.
 * All endpoints require a JSON body (Content-Type: application/json), which a
 * plain cross-site HTML form cannot send without a CORS preflight.
 */

const express = require('express');
const pushModel = require('../models/push');
const pushService = require('../services/push');

const router = express.Router();
const json = express.json({ limit: '10kb' });

function requireJson(req, res, next) {
  if (!req.is('application/json')) return res.status(415).json({ ok: false, error: 'Expected application/json' });
  next();
}

function requireConfigured(req, res, next) {
  if (!pushService.isConfigured()) return res.status(503).json({ ok: false, error: 'Push notifications are not configured on this server' });
  next();
}

router.post('/subscribe', requireConfigured, requireJson, json, async (req, res) => {
  const subscription = pushService.validateSubscription(req.body && req.body.subscription);
  if (!subscription) return res.status(400).json({ ok: false, error: 'Invalid push subscription' });
  try {
    await pushModel.saveSubscription(subscription);
    res.status(201).json({ ok: true });
  } catch (err) {
    console.error('[PUSH] save subscription failed:', err.message);
    res.status(500).json({ ok: false, error: 'Could not save subscription' });
  }
});

router.post('/unsubscribe', requireJson, json, async (req, res) => {
  const endpoint = req.body && typeof req.body.endpoint === 'string' ? req.body.endpoint : null;
  try {
    await pushModel.clearSubscription(endpoint);
    res.json({ ok: true });
  } catch (err) {
    console.error('[PUSH] clear subscription failed:', err.message);
    res.status(500).json({ ok: false, error: 'Could not remove subscription' });
  }
});

router.post('/test', requireConfigured, requireJson, json, async (req, res) => {
  try {
    const subscription = await pushModel.getSubscription();
    if (!subscription) return res.status(404).json({ ok: false, error: 'No subscription saved yet' });
    const result = await pushService.sendPush(subscription, {
      title: '☂️ Pack & Wear alarms are on',
      body: "You'll get a heads-up here when rain starts or temperatures drop in your saved cities.",
      url: '/',
      tag: 'pack-and-wear-test',
    });
    // A subscription the push service won't accept is useless: drop it and tell the
    // browser to create a fresh one (the client does this automatically).
    if (result.resubscribe) await pushModel.clearSubscription(subscription.endpoint);
    res.status(result.ok ? 200 : 502).json({
      ok: result.ok,
      statusCode: result.statusCode,
      resubscribe: result.resubscribe,
      error: result.error,
      detail: result.detail,
    });
  } catch (err) {
    console.error('[PUSH] test failed:', err.message);
    res.status(500).json({ ok: false, error: 'Test notification failed' });
  }
});

module.exports = router;
