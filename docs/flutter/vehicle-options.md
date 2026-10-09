# Driver vehicle options API

Use this endpoint on the vehicle-registration step of driver onboarding. Its values are supplied only from active vehicle master data configured by an admin.

## Get options

```http
GET /api/v1/vehicles/options
Cookie: fleet_session=<driver-session-cookie>
```

The driver must be logged in. The API returns `401 Unauthorized` when the session cookie is absent or invalid.

```json
{
  "success": true,
  "message": "Request completed successfully",
  "data": {
    "categories": [
      {
        "id": "0ebd561d-7fc1-4430-9c05-50437d61b47f",
        "name": "Sedan",
        "slug": "sedan",
        "description": "Comfortable city rides",
        "iconUrl": null,
        "imageUrl": null,
        "capacity": 4,
        "baseFare": 50,
        "perKmRate": 12,
        "perMinuteRate": 2
      }
    ],
    "brands": [
      {
        "id": "b35f6d3d-f0c1-439f-8916-5fe09e568a67",
        "name": "Hyundai",
        "slug": "hyundai"
      }
    ],
    "models": [
      {
        "id": "91144ab2-2a14-47ec-978d-67a41e6155d9",
        "name": "Verna",
        "slug": "verna",
        "brandId": "b35f6d3d-f0c1-439f-8916-5fe09e568a67",
        "categoryId": "0ebd561d-7fc1-4430-9c05-50437d61b47f"
      }
    ],
    "manufacturerYears": [
      {
        "id": "05660829-f134-4bd9-8edc-fdd27fbd7f01",
        "year": 2026
      }
    ],
    "years": [2026]
  }
}
```

`years` is retained as a compatibility list. New code should use `manufacturerYears` when rendering the year dropdown.

## Dropdown behaviour

1. Render all `categories`.
2. Render active `brands`.
3. After a category and brand are selected, show only models where both `model.categoryId == selectedCategory.id` and `model.brandId == selectedBrand.id`.
4. Render `manufacturerYears` by `year`.

The API excludes inactive brands, models, years, categories, and models whose brand or category is inactive. It has no hardcoded fallback values.

## Submit the selected vehicle

Create the vehicle using the driver API:

```http
POST /api/v1/drivers/vehicles
Content-Type: application/json
Cookie: fleet_session=<driver-session-cookie>
```

```json
{
  "categoryId": "0ebd561d-7fc1-4430-9c05-50437d61b47f",
  "brandId": "b35f6d3d-f0c1-439f-8916-5fe09e568a67",
  "modelId": "91144ab2-2a14-47ec-978d-67a41e6155d9",
  "registrationNo": "DL01AB1234",
  "year": 2026,
  "color": "White",
  "fuelType": "PETROL",
  "seatingCapacity": 4
}
```

Always submit IDs from the options response. The backend derives `make` and `model` from the selected admin master records.
