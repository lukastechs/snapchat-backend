import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import fetch from 'node-fetch';

dotenv.config();
const app = express();
app.use(cors());
app.use(express.json());
const PORT = process.env.PORT || 8080;

const SCRAPERTECH_KEY = process.env.SCRAPERTECH_KEY;
if (!SCRAPERTECH_KEY) {
  console.error('SCRAPERTECH_KEY is not set');
  process.exit(1);
}

// Helper function to calculate date range
function calculateDateRange(date, accuracy) {
  const baseDate = new Date(date);
  let monthsToAdd = 0;
  if (accuracy.includes('3 months')) monthsToAdd = 3;
  else if (accuracy.includes('6 months')) monthsToAdd = 6;
  else if (accuracy.includes('12 months')) monthsToAdd = 12;

  const startDate = new Date(baseDate);
  startDate.setMonth(baseDate.getMonth() - monthsToAdd);
  const endDate = new Date(baseDate);
  endDate.setMonth(baseDate.getMonth() + monthsToAdd);

  return {
    start: formatDate(startDate),
    end: formatDate(endDate)
  };
}

// Helper function to format date
function formatDate(date) {
  const options = { year: 'numeric', month: 'long', day: 'numeric' };
  return date.toLocaleDateString('en-US', options);
}

// Helper function to calculate age
function calculateAge(createdDate) {
  const now = new Date();
  const created = new Date(createdDate);
  const diffTime = Math.abs(now - created);
  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
  const diffMonths = Math.floor(diffDays / 30);
  const diffYears = Math.floor(diffMonths / 12);
  if (diffYears > 0) {
    const remainingMonths = diffMonths % 12;
    return `${diffYears} year${diffYears > 1 ? 's' : ''}${remainingMonths > 0 ? ` and ${remainingMonths} month${remainingMonths > 1 ? 's' : ''}` : ''}`;
  } else if (diffMonths > 0) {
    return `${diffMonths} month${diffMonths > 1 ? 's' : ''}`;
  } else {
    return `${diffDays} day${diffDays > 1 ? 's' : ''}`;
  }
}

// Helper function to calculate age in days
function calculateAgeDays(createdDate) {
  const now = new Date();
  const created = new Date(createdDate);
  const diffMs = Math.abs(now - created);
  return Math.floor(diffMs / (1000 * 60 * 60 * 24));
}

app.get('/', (req, res) => {
  res.setHeader('X-Powered-By', 'SocialAgeChecker');
  res.send('Snapchat Age Checker API is running');
});

app.get('/health', (req, res) => {
  res.setHeader('X-Powered-By', 'SocialAgeChecker');
  res.json({ status: 'healthy', timestamp: new Date().toISOString() });
});

app.post('/api/snapchat-age/:username', async (req, res) => {
  const username = req.params.username;

  if (!username || !/^[a-zA-Z0-9._]{3,15}$/.test(username)) {
    console.error(`Invalid username format: ${username}`);
    return res.status(400).json({
      error: 'Invalid username format. Must be 3-15 alphanumeric characters, dots, or underscores.'
    });
  }

  try {
    const recaptchaResponse = req.body.recaptcha;
    if (!recaptchaResponse) {
      return res.status(400).json({ error: 'reCAPTCHA required' });
    }
    const recaptchaVerify = await fetch(
      `https://www.google.com/recaptcha/api/siteverify`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          secret: process.env.RECAPTCHA_SECRET_KEY,
          response: recaptchaResponse,
        }),
      }
    );
    const recaptchaData = await recaptchaVerify.json();
    if (!recaptchaData.success) {
      return res.status(400).json({ error: 'reCAPTCHA verification failed' });
    }

    await new Promise(resolve => setTimeout(resolve, 2000));
    const url = `https://snapchat3.scraper.tech/get-profile?username=${encodeURIComponent(username)}`;
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Accept': 'application/json',
        'scraper-key': SCRAPERTECH_KEY
      }
    });

    const contentType = response.headers.get('Content-Type') || '';
    console.log('ScraperTech Status:', response.status, 'Content-Type:', contentType);

    let data;
    try {
      const text = await response.text();
      data = JSON.parse(text); // Attempt to parse as JSON regardless of Content-Type
    } catch (parseError) {
      console.log('ScraperTech Response (failed to parse):', text.slice(0, 200));
      return res.status(500).json({
        error: 'Failed to parse ScraperTech response',
        details: parseError.message,
        responseText: text.slice(0, 200)
      });
    }

    if (response.ok && data.success && data.data?.info) {
      const user = data.data.info;
      const creationTimestamp = user.creationTimestampMs?.value;
      const creationDate = creationTimestamp ? new Date(parseInt(creationTimestamp)) : null;
      const formattedDate = creationDate ? formatDate(creationDate) : 'Unknown';
      const accountAge = creationDate ? calculateAge(creationDate) : 'Unknown';
      const dateRange = creationDate ? calculateDateRange(creationDate, '±3 months') : { start: 'Unknown', end: 'Unknown' };

      const relatedAccounts = user.relatedAccountsInfo?.map(account => ({
        username: account.publicProfileInfo.username,
        title: account.publicProfileInfo.title,
        profilePictureUrl: account.publicProfileInfo.profilePictureUrl,
        bio: account.publicProfileInfo.bio || 'No bio',
        subscriberCount: account.publicProfileInfo.subscriberCount,
        profileLink: account.subscribeLink?.deepLinkUrl || `https://www.snapchat.com/add/${account.publicProfileInfo.username}`
      })) || [];

      res.setHeader('X-Powered-By', 'SocialAgeChecker');
      res.json({
        username: user.username,
        title: user.title || user.username,
        avatar: user.snapcodeImageUrl || user.profilePictureUrl || '',
        creation_date: formattedDate,
        creation_date_range: dateRange,
        account_age: accountAge,
        age_days: creationDate ? calculateAgeDays(creationDate) : 0,
        bio: user.bio || 'No bio',
        subscriber_count: user.subscriberCount || '0',
        profile_link: `https://www.snapchat.com/add/${user.username}`,
        region: user.address || 'N/A',
        verified: user.badge ? 'Yes' : 'No',
        verified_type: user.badge === 1 ? 'Public Figure' : 'None',
        related_accounts: relatedAccounts,
        estimation_confidence: creationTimestamp ? 'high' : 'unknown',
        estimation_method: creationTimestamp ? 'API Provided Creation Date' : 'None',
        accuracy_range: creationTimestamp ? '±3 months' : 'unknown',
        estimation_details: {
          note: 'Creation date is sourced directly from the ScraperTech Snapchat API. If unavailable, actual creation date may vary. This tool is not affiliated with Snapchat.'
        }
      });
    } else {
      res.status(404).json({
        error: data?.error || 'User not found or profile is private',
        scrapertech_response: data
      });
    }
  } catch (error) {
    console.error('ScraperTech Error:', error.message, error.stack);
    if (error.message.includes('certificate has expired')) {
      res.status(503).json({
        error: 'ScraperTech API unavailable due to expired SSL certificate',
        details: 'Please try again later or contact support.',
        errorMessage: error.message
      });
    } else if (error.message.includes('Unexpected token')) {
      res.status(500).json({
        error: 'Failed to parse ScraperTech response',
        details: 'Received invalid JSON, likely an HTML error page',
        errorMessage: error.message
      });
    } else if (error.response?.status === 429) {
      res.status(429).json({ error: 'Rate limit exceeded. Please try again later.' });
    } else {
      res.status(500).json({
        error: 'Failed to fetch user info from ScraperTech',
        details: error.message
      });
    }
  }
});

app.get('/api/snapchat-age/:username', async (req, res) => {
  const username = req.params.username;

  if (!username || !/^[a-zA-Z0-9._]{3,15}$/.test(username)) {
    console.error(`Invalid username format: ${username}`);
    return res.status(400).json({
      error: 'Invalid username format. Must be 3-15 alphanumeric characters, dots, or underscores.'
    });
  }

  try {
    await new Promise(resolve => setTimeout(resolve, 2000));
    const url = `https://snapchat3.scraper.tech/get-profile?username=${encodeURIComponent(username)}`;
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Accept': 'application/json',
        'scraper-key': SCRAPERTECH_KEY
      }
    });

    const contentType = response.headers.get('Content-Type') || '';
    console.log('ScraperTech Status:', response.status, 'Content-Type:', contentType);

    let data;
    try {
      const text = await response.text();
      data = JSON.parse(text); // Attempt to parse as JSON regardless of Content-Type
    } catch (parseError) {
      console.log('ScraperTech Response (failed to parse):', text.slice(0, 200));
      return res.status(500).json({
        error: 'Failed to parse ScraperTech response',
        details: parseError.message,
        responseText: text.slice(0, 200)
      });
    }

    if (response.ok && data.success && data.data?.info) {
      const user = data.data.info;
      const creationTimestamp = user.creationTimestampMs?.value;
      const creationDate = creationTimestamp ? new Date(parseInt(creationTimestamp)) : null;
      const formattedDate = creationDate ? formatDate(creationDate) : 'Unknown';
      const accountAge = creationDate ? calculateAge(creationDate) : 'Unknown';
      const dateRange = creationDate ? calculateDateRange(creationDate, '±3 months') : { start: 'Unknown', end: 'Unknown' };

      const relatedAccounts = user.relatedAccountsInfo?.map(account => ({
        username: account.publicProfileInfo.username,
        title: account.publicProfileInfo.title,
        profilePictureUrl: account.publicProfileInfo.profilePictureUrl,
        bio: account.publicProfileInfo.bio || 'No bio',
        subscriberCount: account.publicProfileInfo.subscriberCount,
        profileLink: account.subscribeLink?.deepLinkUrl || `https://www.snapchat.com/add/${account.publicProfileInfo.username}`
      })) || [];

      res.setHeader('X-Powered-By', 'SocialAgeChecker');
      res.json({
        username: user.username,
        title: user.title || user.username,
        avatar: user.snapcodeImageUrl || user.profilePictureUrl || '',
        creation_date: formattedDate,
        creation_date_range: dateRange,
        account_age: accountAge,
        age_days: creationDate ? calculateAgeDays(creationDate) : 0,
        bio: user.bio || 'No bio',
        subscriber_count: user.subscriberCount || '0',
        profile_link: `https://www.snapchat.com/add/${user.username}`,
        region: user.address || 'N/A',
        verified: user.badge ? 'Yes' : 'No',
        verified_type: user.badge === 1 ? 'Public Figure' : 'None',
        related_accounts: relatedAccounts,
        estimation_confidence: creationTimestamp ? 'high' : 'unknown',
        estimation_method: creationTimestamp ? 'API Provided Creation Date' : 'None',
        accuracy_range: creationTimestamp ? '±3 months' : 'unknown',
        estimation_details: {
          note: 'Creation date is sourced directly from the ScraperTech Snapchat API. If unavailable, actual creation date may vary. This tool is not affiliated with Snapchat.'
        }
      });
    } else {
      res.status(404).json({
        error: data?.error || 'User not found or profile is private',
        scrapertech_response: data
      });
    }
  } catch (error) {
    console.error('ScraperTech Error:', error.message, error.stack);
    if (error.message.includes('certificate has expired')) {
      res.status(503).json({
        error: 'ScraperTech API unavailable due to expired SSL certificate',
        details: 'Please try again later or contact support.',
        errorMessage: error.message
      });
    } else if (error.message.includes('Unexpected token')) {
      res.status(500).json({
        error: 'Failed to parse ScraperTech response',
        details: 'Received invalid JSON, likely an HTML error page',
        errorMessage: error.message
      });
    } else if (error.response?.status === 429) {
      res.status(429).json({ error: 'Rate limit exceeded. Please try again later.' });
    } else {
      res.status(500).json({
        error: 'Failed to fetch user info from ScraperTech',
        details: error.message
      });
    }
  }
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
