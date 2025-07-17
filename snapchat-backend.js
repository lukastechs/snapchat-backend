import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import fetch from 'node-fetch';

dotenv.config();
const app = express();
app.use(cors());
const PORT = process.env.PORT || 8080;

const SCRAPER_TECH_KEY = process.env.SCRAPER_TECH_KEY;
if (!SCRAPER_TECH_KEY) {
  console.error('SCRAPER_TECH_KEY is not set');
  process.exit(1);
}

// Helper function to calculate date range from accuracy
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

// SnapchatAgeEstimator class
class SnapchatAgeEstimator {
  static estimateFromUsername(username) {
    if (!username) return null;
    const patterns = [
      { regex: /^[a-z0-9]{3,8}$/, dateRange: new Date('2012-06-01') }, // Early accounts (2012–2015)
      { regex: /^[a-z]{3,8}\d{1,3}$/, dateRange: new Date('2015-06-01') }, // Mid-early (2015–2017)
      { regex: /^[a-z0-9._]{5,12}$/, dateRange: new Date('2017-06-01') }, // Mid-era (2017–2020)
      { regex: /^[\w.]{8,15}$/, dateRange: new Date('2020-06-01') } // Recent (2020–2025)
    ];
    for (const pattern of patterns) {
      if (pattern.regex.test(username)) {
        return pattern.dateRange;
      }
    }
    return null;
  }

  static estimateFromDisplayName(displayName) {
    if (!displayName) return null;
    const patterns = [
      { regex: /^[A-Z][a-z]+\s[A-Z][a-z]+$/, dateRange: new Date('2012-06-01') }, // Real names
      { regex: /[\uD800-\uDFFF]/, dateRange: new Date('2016-01-01') }, // Emojis
      { regex: /\d{4}$/, dateRange: new Date('2020-01-01') } // Year suffixes
    ];
    for (const pattern of patterns) {
      if (pattern.regex.test(displayName)) {
        return pattern.dateRange;
      }
    }
    return null;
  }

  static estimateFromFollowers(followers) {
    if (followers > 1000000) return new Date('2018-01-01');
    else if (followers > 100000) return new Date('2019-06-01');
    else if (followers > 10000) return new Date('2021-01-01');
    return new Date('2023-01-01');
  }

  static estimateAccountAge(username, displayName, followers = 0) {
    const estimates = [];
    const confidence = { low: 1, medium: 2 };
    const usernameEst = this.estimateFromUsername(username);
    if (usernameEst) {
      estimates.push({
        date: usernameEst,
        confidence: confidence.medium,
        method: 'Username Pattern'
      });
    }
    const displayNameEst = this.estimateFromDisplayName(displayName);
    if (displayNameEst) {
      estimates.push({
        date: displayNameEst,
        confidence: confidence.medium,
        method: 'Display Name Pattern'
      });
    }
    const followersEst = this.estimateFromFollowers(followers);
    if (followersEst) {
      estimates.push({
        date: followersEst,
        confidence: confidence.low,
        method: 'Follower Count'
      });
    }
    if (estimates.length === 0) {
      return {
        estimatedDate: new Date(),
        confidence: 'very_low',
        method: 'Default',
        accuracy: '±12 months',
        dateRange: calculateDateRange(new Date(), '±12 months')
      };
    }
    const weightedSum = estimates.reduce((sum, est) => sum + (est.date.getTime() * est.confidence), 0);
    const totalWeight = estimates.reduce((sum, est) => sum + est.confidence, 0);
    const finalDate = new Date(weightedSum / totalWeight);
    const maxConfidence = Math.max(...estimates.map(e => e.confidence));
    const confidenceLevel = maxConfidence === 2 ? 'medium' : 'low';
    const primaryMethod = estimates.find(e => e.confidence === maxConfidence)?.method || 'Combined';
    const accuracy = confidenceLevel === 'medium' ? '±6 months' : '±12 months';
    return {
      estimatedDate: finalDate,
      confidence: confidenceLevel,
      method: primaryMethod,
      accuracy,
      dateRange: calculateDateRange(finalDate, accuracy),
      allEstimates: estimates
    };
  }
}

app.get('/', (req, res) => {
  res.setHeader('X-Powered-By', 'SocialAgeChecker');
  res.send('Snapchat Age Checker API is running');
});

app.get('/health', (req, res) => {
  res.setHeader('X-Powered-By', 'SocialAgeChecker');
  res.json({ status: 'healthy', timestamp: new Date().toISOString() });
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
    await new Promise(resolve => setTimeout(resolve, 1000)); // Avoid rate limits
    const url = `https://snapchat3.scraper.tech/get-profile?username=${encodeURIComponent(username)}`;
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'scraper-key': SCRAPER_TECH_KEY,
        'Accept': 'application/json'
      }
    });

    const contentType = response.headers.get('Content-Type') || '';
    console.log('Scraper.Tech Status:', response.status, 'Content-Type:', contentType);

    if (!contentType.includes('application/json')) {
      const text = await response.text();
      console.log('Scraper.Tech Response (non-JSON):', text.slice(0, 200));
      return res.status(response.status).json({
        error: 'Invalid response from Scraper.Tech',
        details: `Expected JSON, received ${contentType}`,
        responseText: text.slice(0, 200)
      });
    }

    const data = await response.json();
    console.log('Scraper.Tech Response:', JSON.stringify(data, null, 2));

    if (response.ok && data && data.userInfo && data.userInfo.user) {
      const user = data.userInfo.user;
      const stats = data.userInfo.stats || {};
      const ageEstimate = SnapchatAgeEstimator.estimateAccountAge(
        user.username || user.uniqueId || username,
        user.displayName || '',
        stats.subscriberCount || stats.followerCount || 0
      );

      if (!user.bio && !user.profileDescription) {
        console.log(`No bio found for ${username}`);
      }

      const formattedDate = formatDate(ageEstimate.estimatedDate);
      const accountAge = calculateAge(ageEstimate.estimatedDate);

      res.setHeader('X-Powered-By', 'SocialAgeChecker');
      res.json({
        username: user.username || user.uniqueId || username,
        nickname: user.displayName || '',
        avatar: user.snapcode || user.profileImageUrl || '',
        followers: stats.subscriberCount || stats.followerCount || 0,
        description: user.bio || user.profileDescription || 'No bio',
        estimated_creation_date: formattedDate,
        estimated_creation_date_range: ageEstimate.dateRange,
        account_age: accountAge,
        estimation_confidence: ageEstimate.confidence,
        estimation_method: ageEstimate.method,
        accuracy_range: ageEstimate.accuracy,
        estimation_details: {
          all_estimates: ageEstimate.allEstimates,
          note: 'This is an estimated creation date based on username, display name, and follower data. Actual creation date may vary. This tool is not affiliated with Snapchat.'
        }
      });
    } else {
      res.status(404).json({
        error: data?.error || 'User not found or profile is private',
        scraper_tech_response: data
      });
    }
  } catch (error) {
    console.error('Scraper.Tech Error:', error.message, error.stack);
    if (error.message.includes('Unexpected token')) {
      res.status(500).json({
        error: 'Failed to parse Scraper.Tech response',
        details: 'Received invalid JSON, likely an HTML error page',
        errorMessage: error.message
      });
    } else if (error.response?.status === 429) {
      res.status(429).json({ error: 'Rate limit exceeded. Please try again later.' });
    } else {
      res.status(500).json({
        error: 'Failed to fetch user info from Scraper.Tech',
        details: error.message
      });
    }
  }
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
