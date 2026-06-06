# Lead Classification — Final Refinements (CR)

If I were making one final refinement before handing this to engineering, I'd make three small changes.

---

## 1. Reduce Driver vs Passenger Weight

**Currently:**

| Role       | Score |
| ---------- | ----- |
| Passenger  | +10   |
| Pedestrian | +10   |
| Cyclist    | +8    |
| Driver     | +5    |

A driver can still have an excellent case. I would change it to:

| Role       | Score |
| ---------- | ----- |
| Passenger  | +10   |
| Pedestrian | +10   |
| Cyclist    | +8    |
| Driver     | +8    |

> This avoids unfairly penalizing drivers.

---

## 2. Increase Weight of "Want to Change Lawyers"

**Current:**

| Attorney Status                               | Score |
| --------------------------------------------- | ----- |
| Signed With Lawyer But Want To Change Lawyers | +5    |

I'd increase this to **+10**.

**Reason:** Someone actively looking to fire their current lawyer is often a very motivated prospect.

**Revised:**

| Attorney Status                                 | Score |
| ----------------------------------------------- | ----- |
| No                                              | +15   |
| Spoke With Lawyers, Haven't Signed Yet          | +12   |
| Signed With Lawyer But Want To Change Lawyers   | +10   |
| Yes, I Have A Lawyer                            | -25   |

---

## 3. Add Reason Codes to Every Lead

Don't just output:

```json
{
  "classification": "HOT",
  "leadScore": 87
}
```

Output:

```json
{
  "classification": "HOT",
  "leadScore": 87,
  "reasons": [
    "Recent accident",
    "Emergency room treatment",
    "Other driver at fault",
    "Insurance requested statement",
    "No attorney retained"
  ]
}
```

> Attorneys love knowing why a lead scored highly.

---

## Final MVP Output

```json
{
  "classification": "HOT",
  "leadScore": 87,
  "geographicQualification": "IN_SERVICE_AREA",
  "requestType": "SELF",
  "reasons": [
    "Accident within 7 days",
    "Emergency room treatment",
    "Other driver at fault",
    "Insurance requested statement",
    "No attorney retained"
  ]
}
```

---

## Closing Note

At this point, I would stop refining and start building. The next improvements should come from reviewing real leads with actual PI attorneys rather than adding more theoretical scoring rules.
