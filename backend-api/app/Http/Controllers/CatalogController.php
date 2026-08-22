<?php

namespace App\Http\Controllers;

use App\Models\FaultCategory;
use App\Models\MaintenanceType;
use Illuminate\Http\Request;

/**
 * CRUD for the two small, user-growable catalogs (fault categories, used
 * as tickets' fault_category / issue reports' issue_type; and maintenance
 * types, used by sub-issues, maintenance records, and schedules) that the
 * CreatableSelect dropdown lets any user add to on the fly.
 *
 * Deliberately its own endpoints instead of deferring the save to whatever
 * form the dropdown happens to be embedded in — the ticket/issue/record
 * that form submits and the catalog entry it references are two separate
 * things, and tying the catalog write to that unrelated submission meant a
 * newly-typed value was silently lost if the user backed out of that form
 * without submitting it.
 */
class CatalogController extends Controller
{
    public function faultCategories()
    {
        return FaultCategory::orderBy('name')->get(['id', 'name']);
    }

    public function storeFaultCategory(Request $request)
    {
        $this->requireRole($request, ['Admin', 'Custodian', 'Maintenance Personnel']);
        $data = $request->validate(['name' => ['required', 'string', 'max:150']]);

        return response()->json(FaultCategory::findOrCreateByName($data['name']), 201);
    }

    public function destroyFaultCategory(Request $request, FaultCategory $faultCategory)
    {
        $this->requireRole($request, ['Admin']);
        $faultCategory->delete();

        return response()->noContent();
    }

    public function maintenanceTypes()
    {
        return MaintenanceType::orderBy('name')->get(['id', 'name']);
    }

    public function storeMaintenanceType(Request $request)
    {
        $this->requireRole($request, ['Admin', 'Custodian', 'Maintenance Personnel']);
        $data = $request->validate(['name' => ['required', 'string', 'max:150']]);

        return response()->json(MaintenanceType::findOrCreateByName($data['name']), 201);
    }

    public function destroyMaintenanceType(Request $request, MaintenanceType $maintenanceType)
    {
        $this->requireRole($request, ['Admin']);
        $maintenanceType->delete();

        return response()->noContent();
    }

    private function requireRole(Request $request, array $roles): void
    {
        abort_unless($request->user()->hasAnyRole($roles), 403, 'Your account role cannot perform this action.');
    }
}
