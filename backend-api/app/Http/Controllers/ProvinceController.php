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
     */
    public function withBarangays()
    {
        return Province::whereHas('cities', fn ($query) => $query->whereHas('barangays'))
            ->orderBy('name')
            ->get(['id', 'name']);
    }
}
