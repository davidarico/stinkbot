# Journal Balancing System

## Overview

The journal balancing system helps manage Discord's 50-channel limit per category by automatically organizing journals into multiple categories when needed.

## Commands

### `Wolf.balance_journals`

**Purpose**: Automatically balance journals across categories to stay within Discord's 50-channel limit.

**Permissions**: Requires moderator permissions (Manage Channels or Administrator)

**How it works**:
1. Finds all journal categories (including existing split categories)
2. Collects all journal channels from all categories
3. Sorts them alphabetically by player name
4. Determines if splitting is needed:
   - **Less than 50 journals**: Just alphabetizes in current structure
   - **50+ journals**: Splits into multiple categories with alphabetical ranges

**Category naming**: Categories are named `Journals (A-L)`, `Journals (M-Z)`, etc., based on the alphabetical range of journals in each category.

**Example output**:
```
📚 Journal Categories Balanced
Successfully reorganized 75 journals into 2 categories.

Total Journals: 75
Categories Created: 2
Journals Moved: 45

Category Breakdown:
• Journals (A-M): 38 journals (A-M)
• Journals (N-Z): 37 journals (N-Z)
```

### `Wolf.populate_journals [number]`

**Purpose**: Create test journals for testing the balancing system.

**Permissions**: Requires moderator permissions (Manage Channels or Administrator)

**Usage**:
- `Wolf.populate_journals` - Creates 50 test journals (default)
- `Wolf.populate_journals 25` - Creates 25 test journals
- `Wolf.populate_journals 100` - Creates 100 test journals

**Limits**: Maximum 100 test journals per command

**Test journal format**: `{random-letter}testuser001-journal`, `{random-letter}testuser002-journal`, etc. (e.g., `atestuser001-journal`, `mtestuser002-journal`)

## How the Balancing Works

### Scenario 1: Less than 50 journals
- Journals stay in the original "Journals" category
- All journals are alphabetized within the category
- No new categories are created

### Scenario 2: 50+ journals
- Splits into multiple categories to stay well under the Discord limit
- **50 journals**: Splits into 2 categories of 25 each
- **75 journals**: Splits into 2 categories of 38 each  
- **100 journals**: Splits into 2 categories of 50 each
- **120+ journals**: Splits into 3+ categories as needed
- Each category contains approximately equal numbers of journals
- Category names reflect the alphabetical range: `Journals (A-L)`, `Journals (M-Z)`, etc.

## Best Practices

1. **Run balance_journals regularly**: When you approach 50 journals, run this command to prevent hitting the limit
2. **Test with populate_journals**: Use this command to test the balancing system before applying it to real journals
3. **Monitor category growth**: Keep an eye on journal category sizes to know when to rebalance
4. **Backup before major changes**: Consider backing up your server structure before running balance_journals on a large number of journals

## Technical Details

- **Alphabetical sorting**: Journals are sorted by the player name (extracted from channel name, removing "-journal" suffix)
- **Category positioning**: New categories are positioned near the original "Journals" category
- **Permission preservation**: All journal permissions are maintained when moving channels
- **Database consistency**: The system works with the existing `player_journals` table structure
- **Rate limiting**: The system includes delays to avoid Discord API rate limits

## Troubleshooting

**"No journal categories found"**
- Create some journals first with `Wolf.journal @user`

**"No journal channels found"**
- Ensure journals are in categories with "Journals" in the name
- Check that journal channels end with "-journal"

**Permission errors**
- Ensure the bot has "Manage Channels" permission
- Check that you have moderator permissions

**Rate limiting**
- The system includes built-in delays, but if you have many journals, the process may take time
- Wait for the command to complete before running it again
