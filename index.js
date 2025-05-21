// Get unused letters and guesses for a player
async function getLettersInfo(userId) {
  // Initialize return message
  let message = '';
  
  // Check if user has made any guesses
  if (!dailyResults[userId] || dailyResults[userId].attempts.length === 0) {
    message = "You haven't made any guesses yet today!";
    return message;
  }
  
  // Get all guesses
  const attempts = dailyResults[userId].attempts;
  const usedLetters = new Set();
  
  // Collect all used letters
  attempts.forEach(attempt => {
    for (const letter of attempt.guess) {
      usedLetters.add(letter.toLowerCase());
    }
  });
  
  // Create a list of unused letters
  const alphabet = 'abcdefghijklmnopqrstuvwxyz';
  const unusedLetters = [];
  
  for (const letter of alphabet) {
    if (!usedLetters.has(letter)) {
      unusedLetters.push(letter.toUpperCase());
    }
  }
  
  // Add unused letters to message with spoiler formatting
  message += `UNUSED LETTERS: ||${unusedLetters.join(', ')}||\n\n`;
  
  // Add past guesses
  attempts.forEach((attempt, index) => {
    const guessNumber = index + 1;
    message += `GUESS: ${guessNumber}\n`;
    
    // Format the guess with spaces between letters to align with emojis
    const spacedGuess = attempt.guess.toUpperCase().split('').join('    ');
    message += `||  ${spacedGuess}||\n`;
    
    message += `${attempt.result}\n\n`;
  });
  
  return message;
}// Import required libraries
const { Client, GatewayIntentBits, EmbedBuilder, REST, Routes } = require('discord.js');
const fs = require('fs');
const path = require('path');
const cron = require('node-cron');
require('dotenv').config();

// Create a new Discord client
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ]
});

// Configuration
const WORDLE_CHANNEL_ID = process.env.WORDLE_CHANNEL_ID; // Set in .env file
const MAX_GUESSES = 6;
const WORD_LENGTH = 5;

// Game state
let currentWord = '';
let currentDay = 0;
let dailyResults = {
  // userId: {guesses: number, attempts: [{guess: string, result: string}], completed: boolean}
};
let wordList = [];

// Emoji mappings
const EMOJI = {
  GREEN: '🟩',
  YELLOW: '🟨',
  BLACK: '⬛',
  CROWN: '👑'
};

// Load or initialize game state
function loadGameState() {
  try {
    if (fs.existsSync('./gameState.json')) {
      const data = fs.readFileSync('./gameState.json', 'utf8');
      const gameState = JSON.parse(data);
      currentWord = gameState.currentWord || '';
      currentDay = gameState.currentDay || 0;
      wordList = gameState.wordList || [];
    } else {
      // Initialize with default values
      currentDay = 1;
      loadWordList();
      pickNewWord();
    }
  } catch (err) {
    console.error('Error loading game state:', err);
    currentDay = 1;
    loadWordList();
    pickNewWord();
  }
  
  // Always reset daily results at startup
  dailyResults = {};
}

// Save game state
function saveGameState() {
  const gameState = {
    currentWord,
    currentDay,
    wordList
  };
  
  fs.writeFileSync('./gameState.json', JSON.stringify(gameState, null, 2));
}

// Load word list from file
function loadWordList() {
  try {
    if (fs.existsSync('./wordList.txt')) {
      const data = fs.readFileSync('./wordList.txt', 'utf8');
      wordList = data.split('\n').map(word => word.trim().toLowerCase())
        .filter(word => word.length === WORD_LENGTH);
      
      if (wordList.length === 0) {
        console.error('Word list is empty. Please add words to wordList.txt');
        // Add some default words just in case
        wordList = ['house', 'plant', 'river', 'smoke', 'field', 'brain', 'cloud'];
      }
    } else {
      // Create default word list if none exists
      wordList = ['house', 'plant', 'river', 'smoke', 'field', 'brain', 'cloud', 
                 'music', 'beach', 'train', 'paper', 'light', 'water', 'phone'];
      fs.writeFileSync('./wordList.txt', wordList.join('\n'));
    }
  } catch (err) {
    console.error('Error loading word list:', err);
    wordList = ['house', 'plant', 'river', 'smoke', 'field', 'brain', 'cloud'];
  }
}

// Pick a new word randomly from the list
function pickNewWord() {
  if (wordList.length > 0) {
    const randomIndex = Math.floor(Math.random() * wordList.length);
    currentWord = wordList[randomIndex].toLowerCase();
    console.log(`[DEBUG] New word chosen: ${currentWord}`);
  } else {
    console.error('Word list is empty!');
    currentWord = 'error';
  }
}

// Check if a guess is valid
function isValidGuess(guess) {
  return guess && guess.length === WORD_LENGTH && /^[a-zA-Z]+$/.test(guess);
}

// Compare guess with actual word and return result array
function checkGuess(guess) {
  guess = guess.toLowerCase();
  const result = Array(WORD_LENGTH).fill(EMOJI.BLACK);
  const letterCounts = {};
  
  // Count letters in the current word
  for (const letter of currentWord) {
    letterCounts[letter] = (letterCounts[letter] || 0) + 1;
  }
  
  // First pass: check for exact matches (green)
  for (let i = 0; i < WORD_LENGTH; i++) {
    if (guess[i] === currentWord[i]) {
      result[i] = EMOJI.GREEN;
      letterCounts[guess[i]]--;
    }
  }
  
  // Second pass: check for partial matches (yellow)
  for (let i = 0; i < WORD_LENGTH; i++) {
    if (guess[i] !== currentWord[i] && letterCounts[guess[i]] > 0) {
      result[i] = EMOJI.YELLOW;
      letterCounts[guess[i]]--;
    }
  }
  
  return result.join('');
}

// Process a player's guess
async function processGuess(userId, username, guess, channel) {
  // Initialize user's results if not already present
  if (!dailyResults[userId]) {
    dailyResults[userId] = {
      guesses: 0,
      attempts: [],
      completed: false
    };
  }
  
  const userResults = dailyResults[userId];
  
  // Check if user already completed their game
  if (userResults.completed) {
    await channel.send(`<@${userId}> You've already finished your Wordle for today!`);
    return;
  }
  
  // Check if user has used all their guesses
  if (userResults.guesses >= MAX_GUESSES) {
    await channel.send(`<@${userId}> You've used all your guesses for today!`);
    return;
  }
  
  // Check if guess is valid format
  if (!isValidGuess(guess)) {
    await channel.send(`<@${userId}> You must guess a 5 letter word.`);
    return;
  }
  
  // Check if the word is in our word list
  const normalizedGuess = guess.toLowerCase().trim();
  if (!wordList.includes(normalizedGuess)) {
    await channel.send(`<@${userId}> Your guess is not on the word list!`);
    return;
  }
  
  // Increment guess count
  userResults.guesses++;
  
  // Check the guess
  const guessResult = checkGuess(guess);
  const attempt = {
    guess: guess.toLowerCase(),
    result: guessResult
  };
  userResults.attempts.push(attempt);
  
  // Construct response message
  let responseMessage = `<@${userId}> - Guess #${userResults.guesses} - ${guessResult}`;
  
  // Check if the guess is correct
  if (guess.toLowerCase() === currentWord) {
    userResults.completed = true;
    responseMessage += `\n<@${userId}> guessed the word in ${userResults.guesses}!`;
  } 
  // Check if user has used all guesses
  else if (userResults.guesses >= MAX_GUESSES) {
    userResults.completed = true;
    responseMessage += `\nBetter luck tomorrow!`;
  }
  
  await channel.send(responseMessage);
  saveGameState();
}

// End the current day and start a new one
async function endDay() {
  try {
    const channel = await client.channels.fetch(WORDLE_CHANNEL_ID);
    if (!channel) {
      console.error(`Could not find channel with ID ${WORDLE_CHANNEL_ID}`);
      return;
    }
    
    // Group results by number of guesses
    const resultsByGuesses = {};
    let bestScore = MAX_GUESSES + 1;
    
    for (const [userId, userResult] of Object.entries(dailyResults)) {
      if (userResult.completed && userResult.attempts.length > 0) {
        const lastAttempt = userResult.attempts[userResult.attempts.length - 1];
        
        // If the user guessed correctly
        if (lastAttempt.guess === currentWord) {
          const guessCount = userResult.guesses;
          
          if (!resultsByGuesses[guessCount]) {
            resultsByGuesses[guessCount] = [];
          }
          
          resultsByGuesses[guessCount].push(userId);
          
          if (guessCount < bestScore) {
            bestScore = guessCount;
          }
        } else {
          // User didn't guess correctly
          if (!resultsByGuesses['X']) {
            resultsByGuesses['X'] = [];
          }
          resultsByGuesses['X'].push(userId);
        }
      } else if (userResult.guesses > 0) {
        // User attempted but didn't complete
        if (!resultsByGuesses['X']) {
          resultsByGuesses['X'] = [];
        }
        resultsByGuesses['X'].push(userId);
      }
    }
    
    // Construct the day's results message
    let resultsMessage = `Tadpole Wordle #${currentDay}: **${currentWord}**\n\nTODAY'S RESULTS:`;
    
    // Add results by guess count (best to worst)
    for (let i = 1; i <= MAX_GUESSES; i++) {
      if (resultsByGuesses[i] && resultsByGuesses[i].length > 0) {
        const emoji = i === bestScore ? EMOJI.CROWN : '';
        resultsMessage += `\n${emoji}${i}/6: ${resultsByGuesses[i].map(id => `<@${id}>`).join(', ')}`;
      }
    }
    
    // Add users who didn't guess correctly
    if (resultsByGuesses['X'] && resultsByGuesses['X'].length > 0) {
      resultsMessage += `\nX/6: ${resultsByGuesses['X'].map(id => `<@${id}>`).join(', ')}`;
    }
    
    // Send the day's results
    await channel.send(resultsMessage);
    
    // Increment the day counter
    currentDay++;
    
    // Reset daily results and pick a new word
    dailyResults = {};
    pickNewWord();
    
    // Send the new day message
    await channel.send(`Tadpole Wordle #${currentDay}\n\nA new 5 letter word has been chosen! Use /guess [your guess] to make a guess!`);
    
    // Save the updated game state
    saveGameState();
  } catch (err) {
    console.error('Error ending day:', err);
  }
}

// Reset the Wordle game and start a new day
async function resetWordle(interaction) {
  try {
    console.log('Reset Wordle command triggered');
    
    // Get the channel
    const channel = interaction.channel;
    
    if (channel.id !== WORDLE_CHANNEL_ID) {
      await interaction.reply({ 
        content: `This command can only be used in the Wordle channel.`,
        ephemeral: true
      });
      return;
    }
    
    // Check if user has admin permissions
    if (!interaction.member.permissions.has('Administrator')) {
      console.log('User lacks admin permission');
      await interaction.reply({ 
        content: `You need administrator permissions to use this command.`,
        ephemeral: true
      });
      return;
    }

    // Reset the daily results
    dailyResults = {};
    
    // Increment the day counter
    currentDay++;
    
    // Pick a new word
    pickNewWord();
    
    // Send the new day message
    await channel.send(`Tadpole Wordle #${currentDay}\n\nA new 5 letter word has been chosen! Use /guess [your guess] to make a guess!`);
    
    // Save the updated game state
    saveGameState();
    
    // Reply to the interaction
    await interaction.reply({
      content: `Wordle game has been reset. New word chosen for day #${currentDay}.`,
      ephemeral: true
    });
    
    console.log(`Game reset by admin. New word: ${currentWord}, Day: ${currentDay}`);
  } catch (err) {
    console.error('Error resetting game:', err);
    await interaction.reply({
      content: `An error occurred while resetting the game.`,
      ephemeral: true
    });
  }
}

// Set up the slash commands
const commands = [
  {
    name: 'guess',
    description: 'Make a wordle guess',
    options: [
      {
        name: 'word',
        description: 'Your 5-letter word guess',
        type: 3, // STRING type
        required: true
      }
    ]
  },
  {
    name: 'resetwordle',
    description: 'Admin only: Reset the Wordle game and start a new day',
    default_member_permissions: '8', // 8 is the permission flag for ADMINISTRATOR
  },
  {
    name: 'letters',
    description: 'Show unused letters and your past guesses',
  }
];

// When the client is ready, register slash commands and set up scheduled tasks
client.once('ready', async () => {
  console.log(`Logged in as ${client.user.tag}`);
  
  try {
    // Load game state
    loadGameState();
    
    // Register commands
    const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
    
    console.log('Started refreshing application (/) commands.');
    console.log('Registering commands:', JSON.stringify(commands));
    
    await rest.put(
      Routes.applicationCommands(client.user.id),
      { body: commands }
    );
    
    console.log('Successfully reloaded application (/) commands.');
    
    // new day at 3pm
    cron.schedule(
      '15 15 * * *',    // minute 0, hour 15 (3 PM), every day
      endDay,
      { timezone: 'America/Phoenix' }
    );
    
    // Debug message
    console.log(`Current word: ${currentWord}`);
    console.log(`Current day: ${currentDay}`);
    
  } catch (error) {
    console.error('Error during initialization:', error);
  }
});

// Handle interactions (slash commands)
client.on('interactionCreate', async interaction => {
  if (!interaction.isCommand()) return;
  
  const { commandName, options, channelId, user } = interaction;
  console.log(`Command received: ${commandName} from user ${user.tag} in channel ${channelId}`);
  
  if (commandName === 'guess') {
    // Only process commands in the Wordle channel
    if (channelId !== WORDLE_CHANNEL_ID) {
      await interaction.reply({ 
        content: `This command can only be used in the Wordle channel.`,
        ephemeral: true
      });
      return;
    }
    
    const guess = options.getString('word');
    
    // Acknowledge the interaction but don't show any message
    await interaction.deferReply({ ephemeral: true });
    
    // Process the guess
    await processGuess(user.id, user.username, guess, interaction.channel);
    
    // Complete the interaction without showing a message
    await interaction.deleteReply();
  } else if (commandName === 'resetwordle') {
    console.log('Reset Wordle command detected');
    // Handle resetwordle command
    await resetWordle(interaction);
  } else if (commandName === 'letters') {
    // Only process commands in the Wordle channel
    if (channelId !== WORDLE_CHANNEL_ID) {
      await interaction.reply({ 
        content: `This command can only be used in the Wordle channel.`,
        ephemeral: true
      });
      return;
    }
    
    // Acknowledge the interaction
    await interaction.deferReply({ ephemeral: true });
    
    // Get letters info
    const lettersInfo = await getLettersInfo(user.id);
    
    // Send the message to the channel
    await interaction.channel.send(`<@${user.id}>\n${lettersInfo}`);
    
    // Complete the interaction without showing a message
    await interaction.deleteReply();
  }
});

// Also listen for message-based commands (as backup)
client.on('messageCreate', async message => {
  // Ignore messages from bots to prevent loops
  if (message.author.bot) return;
  
  // Only process in the correct channel
  if (message.channelId !== WORDLE_CHANNEL_ID) return;
  
  // Check for admin-only manual reset command
  if (message.content.toLowerCase() === '!resetwordle') {
    console.log('Manual reset command detected');
    
    // Check if user has admin permissions
    if (!message.member.permissions.has('Administrator')) {
      await message.reply('You need administrator permissions to use this command.');
      return;
    }
    
    // Reset the daily results
    dailyResults = {};
    
    // Increment the day counter
    currentDay++;
    
    // Pick a new word
    pickNewWord();
    
    // Send the new day message
    await message.channel.send(`Tadpole Wordle #${currentDay}\n\nA new 5 letter word has been chosen! Use /guess [your guess] to make a guess!`);
    
    // Save the updated game state
    saveGameState();
    
    await message.reply('Wordle game has been reset successfully!');
    
    console.log(`Game manually reset by admin. New word: ${currentWord}, Day: ${currentDay}`);
  }
});

// Login to Discord
console.log('DEBUG: token length =', process.env.DISCORD_TOKEN?.length);
console.log('DEBUG: token starts =', process.env.DISCORD_TOKEN?.slice(0, 5));

client.login(process.env.DISCORD_TOKEN);