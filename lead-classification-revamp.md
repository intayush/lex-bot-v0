# Lead Classification

## Classification Tiers

| Lead Score | Classification |
| ---------- | -------------- |
| 76–100     | HOT            |
| 51–75      | WARM           |
| 26–50      | COLD           |
| 0–25       | SPAM / INVALID |

---

## Separate Metadata (Not Scored)

These fields are captured for routing and qualification but do **not** affect the Lead Score.

### Request Type

> **Question:** Are you asking for yourself or a friend/family member?

**Buttons:**
- Myself
- Friend / Family Member

**Score:** `0`

**Store:**
```json
{ "requestType": "SELF" }
```
or
```json
{ "requestType": "FRIEND_FAMILY" }
```

### Geographic Qualification

> **Question:** Did the accident happen in or near `{{Firm Service Area}}`?

**Buttons:**
- Yes
- No

**If No, ask:**
- City
- State

**Score:** `0`

**Store:**
- `IN_SERVICE_AREA`
- `OUTSIDE_SERVICE_AREA`

> This does not affect Lead Score.

---

## Lead Score Questions

### Question 1 — Accident Timing

> When did the accident happen?

| Answer                 | Score |
| ---------------------- | ----- |
| Today                  | +20   |
| Within Last 7 Days     | +15   |
| Within Last 30 Days    | +10   |
| Within Last 6 Months   | +5    |
| More Than 6 Months Ago | 0     |

### Question 2 — Injury

> Were you (or they) injured?

| Answer                  | Score |
| ----------------------- | ----- |
| Yes                     | +15   |
| Still Being Evaluated   | +10   |
| Not Sure Yet            | +5    |
| No                      | -20   |

### Question 3 — Medical Treatment

> What medical treatment was received?

| Answer                            | Score |
| --------------------------------- | ----- |
| Surgery                           | +25   |
| Hospitalization                   | +20   |
| Emergency Room Visit              | +15   |
| Doctor Visit                      | +10   |
| Physical Therapy / Chiropractor   | +8    |
| No Treatment Yet                  | +5    |
| No Treatment                      | -10   |

### Question 4 — Accident Role

> Were you (or they) a:

**Buttons:**
- Driver
- Passenger
- Pedestrian
- Cyclist

| Answer     | Score |
| ---------- | ----- |
| Passenger  | +10   |
| Pedestrian | +10   |
| Cyclist    | +8    |
| Driver     | +5    |

> **Reason:** Passengers and pedestrians often present fewer liability issues.

### Question 5 — Liability

> Who do you believe was primarily responsible for the accident?

| Answer                  | Score |
| ----------------------- | ----- |
| The Other Driver        | +15   |
| Mostly The Other Driver | +10   |
| Not Sure                | +5    |
| Both Drivers            | 0     |
| Mostly Me               | -20   |

### Question 6 — Insurance Activity

> Has an insurance company contacted you (or them)?

| Answer                        | Score |
| ----------------------------- | ----- |
| Requested Recorded Statement  | +15   |
| Offered Settlement            | +15   |
| Asked To Sign Documents       | +15   |
| Contacted Me                  | +5    |
| Not Yet                       | 0     |

### Question 7 — Work Impact

> Has the accident affected your (or their) ability to work?

| Answer          | Score |
| --------------- | ----- |
| Unable To Work  | +15   |
| Missed Work     | +10   |
| No Impact       | 0     |
| Not Applicable  | 0     |

### Question 8 — Attorney Status

> Do you currently have a lawyer?

| Answer                                          | Score |
| ----------------------------------------------- | ----- |
| No                                              | +15   |
| Spoke With Lawyers, Haven't Signed Yet          | +12   |
| Signed With Lawyer But Want To Change Lawyers   | +5    |
| Yes, I Have A Lawyer                            | -25   |

### Question 9 — Contact Information

**Phone Number**

| Answer              | Score |
| ------------------- | ----- |
| Valid Phone Number  | +5    |
| Missing             | 0     |

**Email Address**

| Answer       | Score |
| ------------ | ----- |
| Valid Email  | +5    |
| Missing      | 0     |

**Maximum:** `+10`

---

## Hard Override Rules

These override everything. Automatically classify as **SPAM / INVALID** if any of the following apply:

### Rule 1 — Missing Contact

No phone number **AND** no email.

### Rule 2 — No Injury and No Treatment

Injury = `No` **AND** Treatment = `No Treatment`

### Rule 3 — Obvious Fake Information

Examples:
- Phone = `123456`
- Email = `test@test`
- Name = `Test User`

### Rule 4 — Out of Scope

Not a car accident matter.

---

## Final Formula

```
Lead Score =
    Accident Timing
  + Injury
  + Treatment
  + Accident Role
  + Liability
  + Insurance Activity
  + Work Impact
  + Attorney Status
  + Contact Information
```

Then cap the score:

```
If Lead Score > 100
    Lead Score = 100
```

---

## Examples

### Example: HOT Lead

| Factor                          | Score |
| ------------------------------- | ----- |
| Accident today                  | +20   |
| Injured                         | +15   |
| ER Visit                        | +15   |
| Driver                          | +5    |
| Other Driver At Fault           | +15   |
| Insurance Requested Statement   | +15   |
| Missed Work                     | +10   |
| No Lawyer                       | +15   |
| Phone + Email                   | +10   |
| **Raw Score**                   | **120** |
| **Cap**                         | **100** |
| **Classification**              | **HOT** |

### Example: WARM Lead

| Factor                  | Score |
| ----------------------- | ----- |
| Accident 2 months ago   | +5    |
| Injured                 | +15   |
| Doctor Visit            | +10   |
| Driver                  | +5    |
| Liability unclear       | +5    |
| No insurance contact    | 0     |
| No work impact          | 0     |
| No lawyer               | +15   |
| Contact info            | +10   |
| **Score**               | **65** |
| **Classification**      | **WARM** |

---

## Summary

This gives you a lean intake with only the questions that materially affect a PI lawyer's decision-making, while keeping the scoring model simple enough for attorneys to understand and trust.
