<?php

namespace App\Http\Controllers;

use App\Models\Province;

class ProvinceController extends Controller
{
    /**
     * Public list for the registration form's province dropdown.
     */
    public function index()
    {
        return Province::orderBy('name')->get(['id', 'name']);
    }

    /**
     * Provinces that have at least one city with a registered barangay
     * list (Mandaue City, Cebu today) — used by the admin Vehicle Location
     * map's boundary selector, which only makes sense for barangays we
     * actually have boundary data for. Unlike index(), this is NOT the
     * full nationwide list — registrants can be from anywhere, but the
     * map selector only has real data for this small, growing subset.
     *
     * Each province also carries the id/name of the specific city within
     * it that has the barangay data (city_with_barangays_id/_name) — the
     * frontend used to find that city by hardcoding the name "Mandaue
     * City", which only worked because that was the sole seeded example.
     * If a province ever has more than one qualifying city, the first one
     * (alphabetically) is reported.
     */
    public function withBarangays()
    {
        return Province::whereHas('cities', fn ($query) => $query->whereHas('barangays'))
            ->with(['cities' => fn ($query) => $query->whereHas('barangays')->orderBy('name')])
            ->orderBy('name')
            ->get(['id', 'name'])
            ->map(function (Province $province) {
                $city = $province->cities->first();

                return [
                    'id' => $province->id,
                    'name' => $province->name,
                    'city_with_barangays_id' => $city?->id,
                    'city_with_barangays_name' => $city?->name,
                ];
            });
    }
}
