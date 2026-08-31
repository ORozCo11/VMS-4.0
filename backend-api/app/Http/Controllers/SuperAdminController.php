<?php

namespace App\Http\Controllers;

use App\Models\ActivityLog;
use App\Models\Barangay;
use App\Models\RegistrationSetting;
use App\Models\User;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;

/**
 * Platform-level account administration — the one tier above every
 * barangay's own Admin. Deliberately scoped to ACCOUNTS only (users,
 * barangays, registration codes, impersonation, the audit log): a Super
 * Admin can never see a barangay's vehicles, tickets, or other fleet data.
 * That boundary is what keeps "separate everything per barangay" true even
 * with this role in the system — see BelongsToBarangay's docblock for why
 * User itself is never scoped, which is exactly what lets a barangay_id-less
 * Super Admin see across every barangay here without any special-casing.
 */
class SuperAdminController extends Controller
{
    private const ROLES = ['Admin', 'Custodian', 'Maintenance Personnel'];

    private function requireSuperAdmin(Request $request): void
    {
        abort_unless($request->user()->hasRole('Super Admin'), 403, 'Only a Super Admin can perform this action.');
    }

    private function log(Request $request, string $action, string $details): void
    {
        ActivityLog::create([
            'user_id' => $request->user()->id,
            'role'    => $request->user()->role,
            'action'  => $action,
            'module'  => 'Super Admin',
            'details' => $details,
        ]);
    }

    /**
     * Every barangay, with its staff count and whether it currently has an
     * active Admin — an "orphaned" barangay (none) is the case this whole
     * role exists to let someone recover from.
     */
    public function barangays(Request $request)
    {
        $this->requireSuperAdmin($request);

        return Barangay::with('city.province')
            ->withCount('users')
            ->orderBy('name')
            ->get()
            ->map(fn ($b) => [
                'id' => $b->id,
                'name' => $b->name,
                'city_name' => $b->city?->name,
                'province_name' => $b->city?->province?->name,
                'staff_count' => $b->users_count,
                'has_active_admin' => $b->users()->havingRole('Admin')->where('is_active', true)->exists(),
            ]);
    }

    /**
     * Every user, across every barangay — the one screen in the whole
     * system where that's true. Search matches name or email.
     */
    public function users(Request $request)
    {
        $this->requireSuperAdmin($request);

        $query = User::with('barangay.city.province');

        if ($request->filled('q')) {
            $search = $request->string('q');
            $query->where(fn ($q) => $q->where('name', 'like', "%{$search}%")->orWhere('email', 'like', "%{$search}%"));
        }

        return $query->orderBy('name')->get()->map(fn ($u) => [
            'id' => $u->id,
            'name' => $u->name,
            'email' => $u->email,
            'role' => $u->role,
            'roles' => $u->roles,
            'is_active' => $u->is_active,
            'approved_at' => $u->approved_at,
            'barangay_id' => $u->barangay_id,
            'barangay_name' => $u->barangay?->name,
            'city_name' => $u->barangay?->city?->name,
            'province_name' => $u->barangay?->city?->province?->name,
        ]);
    }

    public function activateUser(Request $request, User $user)
    {
        $this->requireSuperAdmin($request);

        $user->update(['is_active' => true, 'approved_at' => $user->approved_at ?? now()]);
        $this->log($request, 'Activate', "Activated {$user->name} ({$user->email}).");

        return response()->json(['message' => 'User activated.']);
    }

    public function deactivateUser(Request $request, User $user)
    {
        $this->requireSuperAdmin($request);
        abort_if($user->id === $request->user()->id, 422, 'You cannot deactivate your own account.');

        $user->update(['is_active' => false]);
        $user->tokens()->delete();
        $this->log($request, 'Deactivate', "Deactivated {$user->name} ({$user->email}).");

        return response()->json(['message' => 'User deactivated.']);
    }

    /**
     * Change a user's role — also how an orphaned barangay gets recovered:
     * pick an existing user there and set their role to Admin.
     */
    public function updateUserRole(Request $request, User $user)
    {
        $this->requireSuperAdmin($request);

        $data = $request->validate([
            'role' => ['required', Rule::in(self::ROLES)],
        ]);

        $user->update(['role' => $data['role'], 'roles' => [$data['role']]]);
        $this->log($request, 'Edit', "Changed {$user->name}'s role to {$data['role']}.");

        return $user->fresh();
    }

    public function registrationCode(Request $request, Barangay $barangay)
    {
        $this->requireSuperAdmin($request);

        return response()->json(['staff_code' => RegistrationSetting::for($barangay->id)->staff_code]);
    }

    public function regenerateRegistrationCode(Request $request, Barangay $barangay)
    {
        $this->requireSuperAdmin($request);

        $setting = RegistrationSetting::regenerateFor($barangay->id);
        $this->log($request, 'Edit', "Regenerated the staff registration code for {$barangay->name}.");

        return response()->json(['staff_code' => $setting->staff_code]);
    }

    /**
     * Unscoped by design — BelongsToBarangay's global scope only narrows a
     * query when the VIEWER has a barangay_id, which a Super Admin never
     * does. Every barangay's own Admin still only ever sees their own
     * barangay's entries through the same model, unchanged.
     */
    public function activityLog(Request $request)
    {
        $this->requireSuperAdmin($request);

        return ActivityLog::with('user')->latest('log_id')->limit(200)->get();
    }
}
