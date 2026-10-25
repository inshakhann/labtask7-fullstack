<<<<<<< HEAD
# Northfield Goods – REST API (Lab 4)

Persistent back end for the Lab 3 store. Express + SQLite (`store.db` is created on first run and seeded with the 8 products and 4 reviews), bcrypt password hashing, JWT auth.

## Run
```
npm install
npm start            # http://localhost:3000
```
Optional env vars: `PORT`, `JWT_SECRET`, `DB_FILE`.

Send the token on protected routes: `Authorization: Bearer <token>`

## Endpoints
| Method | Path | Auth | Body / Query | Purpose |
|---|---|---|---|---|
| POST | /api/auth/signup | – | name, email, password (min 6) | Create account, returns user + token |
| POST | /api/auth/login | – | email, password | Log in, returns user + token |
| GET | /api/auth/me | ✔ | – | Current user |
| GET | /api/products | – | ?category= | List products (with avg_rating, review_count) |
| GET | /api/categories | – | – | Category names for the filter |
| GET | /api/products/:id | – | – | Single product |
| GET | /api/reviews | – | ?limit=4 | Latest reviews (home page) |
| GET | /api/products/:id/reviews | – | – | Reviews of a product |
| POST | /api/products/:id/reviews | optional | name, rating 1-5, text | Post a review |
| DELETE | /api/reviews/:id | ✔ | – | Delete own review |
| GET | /api/cart | ✔ | – | Cart items + subtotal |
| POST | /api/cart/items | ✔ | productId, qty=1 | Add to cart |
| PATCH | /api/cart/items/:productId | ✔ | qty (<1 removes) | Change quantity |
| DELETE | /api/cart/items/:productId | ✔ | – | Remove item |
| DELETE | /api/cart | ✔ | – | Empty cart |
| POST | /api/orders | ✔ | address, city, postalCode, payment | Checkout: cart becomes an order |
| GET | /api/orders | ✔ | – | My order history |
| GET | /api/orders/:id | ✔ | – | One order |
| GET | /api/health | – | – | Health check |

Status codes: 200/201 success, 204 deleted, 400 validation, 401 not logged in, 403 not allowed, 404 not found, 409 email already registered.

## Quick test
```
curl -X POST localhost:3000/api/auth/signup -H "Content-Type: application/json" \
  -d '{"name":"Ali Khan","email":"ali@x.com","password":"secret1"}'
curl localhost:3000/api/products
```
Prices are always read from the database at checkout, so the client cannot tamper with totals.
=======
# labtask7-fullstack
>>>>>>> 87e323a6f2036bbec4e61a9996c6f707ea65e5ee
