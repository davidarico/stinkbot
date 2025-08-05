### 1. Order of Operations (OoO)

> “The OoO is used only for tie-breaking; roles still perform their full functions regardless of OoO. Always apply _action priority_ first, then use OoO if two actions are otherwise concurrent.”

**Sequence (highest → lowest):**  
1. **Arson (Lighting)**  
2. **Misc First Moves**  
   - Lookout (Town)  
   - Veteran (Town)  
   - Stalker (Wolf)  
   - Locksmith (Town)  
   - Patrolman / Housewatcher (Town)  
   - Sleepwalker (Town)  
   - Orphan (Neutral)  
3. **Blocking Roles**  
   - Jailkeeper (Town)  
   - Escort (Town)  
   - Consort (Wolf)  
4. **Info Roles**  
   - Framer (Wolf)  
   - Seer (Town)  
   - Bartender (Town)  
   - Gravedigger (Town)  
   - Graverobber (Neutral)  
   - Clairvoyant / Bloodhound (Wolf)  
5. **Killing Roles**  
   - Hypnotist (Wolf)  
   - Hunter / Vigilante (Town)  
   - Vigilante Suicide (Town)  
   - Arsonist (Neutral)  
   - Plague Bringer (Neutral)  
   - Serial Killer / Murderer (Neutral)  
   - Glutton (Wolf)  
   - Alpha (Wolf)  
6. **Last but Not Least**  
   - Doctor (Town)  

> _Custom roles slot into the closest matching category (e.g. “Murderer” alongside “Serial Killer”)._

---

### 2. Rampage Mechanics

- **Which roles can be rampaged?**  
  - Escort (Town)  
  - Sleepwalker (Town)  
  - Orphan (Neutral)  
  - Lone Wolf (Wolf)  

- **Exceptions:**  
  - Consort does _not_ rampage.  

- **When rampages kill:**  
  - The target must die at _their own_ home (including porch).  
  - Rampaged roles die at the _target’s_ home.  

- **Escort edge case:**  
  - Escort can be killed at either their _target’s_ home or their _own_ home.

---

### 3. Alpha + Serial Killer Conflict

- **Serial Killer** acts _before_ Alpha (per OoO).  
- If both target the same player:  
  1. SK kills → target is dead  
  2. Alpha arrives → finds target already dead → no effect  

---

### 4. Multiple Attacks + Healing

- **SK + Alpha + Doctor on one target:**  
  1. SK kills  
  2. Alpha does nothing (target already dead)  
  3. Doctor heals → target survives  

- **Plague + another killer + Doctor:**  
  1. Evil/neutral killer kills  
  2. Doctor heals from that attack  
  3. Plague resolves → target dies  

---

### 5. Home-Targeting

- **Can be targeted at home:**  
  Everyone _except_ Sleepwalker, Orphan, Lone Wolf  
- **Cannot be targeted at home:**  
  Sleepwalker, Orphan, Lone Wolf (they spend the night elsewhere)  
- **Framer exception:**  
  Can frame Sleepwalker & Orphan even though they’re away  

---

### 6. Framing Effects

| Info Role   | Effect                                                                                    |
|-------------|-------------------------------------------------------------------------------------------|
| Seer        | Sees the framed player as a random Wolf role from game start                             |
| Lookout     | Sees the framed player traveling to the Night Kill target                                |
| Bartender   | Visits framed player → receives three _lies_                                             |
| Patrolman   | Sees opposite movement (visits framed home instead)                                      |
| Matchmaker  | Matches framed as Neutral/Wolf rather than Town                                          |
| Gravedigger | Upon digging (if still framed) → sees them as Wolf                                       |

---

### 7. Block Notifications

- **Escort / Consort / Locksmith:**  
  - _Only moving roles_ are notified when blocked.  
  - Exception: Sleepwalker is not notified by Locksmith.  
- **Jailkeeper:**  
  - _All_ players (moving or not) receive a notification.  
- **No-move exception:**  
  - If a role’s night action doesn’t require leaving home (e.g. Doctor self-heal, Locksmith building lock), they aren’t notified.

---

### 8. Block Effects

- **Blocks movement-based actions:**  
  Escort, Consort, Locksmith  
- **Blocks all actions except Seer’s:**  
  Jailkeeper  

---

### 9. Body Placement

- **Default location:** inside the victim’s own house (with flavor text)  
  - Alpha → blood & fur  
  - Stalker → on their porch  
  - Patrolman → both parties outside target’s door  
  - SK → stabbed wounds  
  - Murderer → axe wounds  
  - Arsonist → burned  
  - Hypnotist → improvised weapon  
  - Hunter/Vigilante → bullet holes  
  - Veteran → vanished  

- **Rampaged bodies:** inside their _target’s_ home  
- **Blocked-killer bodies:** blocker’s body in Town Square if they block SK/Murderer  

---

### 10. Re-targeting Same Player

Allowed when any of these is true:

1. Role is Alpha Wolf  
2. Role is Plague Bringer  
3. Player was prevented from _leaving home_ (e.g. blocked before moving)  

> _Attempting but failing to reach a jailed/locked target still counts as having left home._

---

### 11. Bartender Result Pool

- **Includes only:** roles _in the actual game_ at start  
- **Excludes:**  
  - Sleepwalker, Orphan, Lone Wolf (untargetable at home)  
  - Heir (treated as Villager)  
- **Bartender can appear** in results only if there was a _second_ Bartender  
- **Repeat visits:** each visit yields a fresh, random pool  

---

### 12. Conversion Roles

- **Convert at Day Start** (after their Night Action fires as original role)  
- **Charge inheritance:** if new role uses charges, receive full set  
- **Kill-count roles:** new win-count = original player's count  
- **Dig inheritances:**  
  - Arsonist → inherits douses  
  - Plague Bringer → inherits infections + carrier count  
- **Theme swap:** in themed games, conversion role adopts new theme  
