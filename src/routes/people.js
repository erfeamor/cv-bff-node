const express = require('express');

const router = express.Router();

const DOMAIN_SERVICE_URL = process.env.DOMAIN_SERVICE_URL || 'http://localhost:8080';

function normalize(person) {
  return {
    name: person.fullName,
    headline: person.headline,
    location: person.location,
    summary: person.summary,
  };
}

router.get('/people/:id', async (req, res, next) => {
  try {
    const response = await fetch(`${DOMAIN_SERVICE_URL}/api/v1/people/${req.params.id}`);
    if (!response.ok) {
      return res.status(response.status).json({ error: 'upstream error' });
    }
    const person = await response.json();
    res.json(normalize(person));
  } catch (err) {
    next(err);
  }
});

module.exports = router;
