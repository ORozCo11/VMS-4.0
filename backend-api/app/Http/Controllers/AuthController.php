<?php

namespace App\Http\Controllers;

use Illuminate\Http\Request;
use App\Models\ActivityLog;
use App\Models\Barangay;
use App\Models\RegistrationSetting;
use App\Models\User;
use Illuminate\Support\Facades\Hash;
use Illuminate\Validation\Rule;

class AuthController extends Controller
{
    /**
     * Public self-registration. Residents/staff sign up naming their own
     * barangay, but the account is created inactive — an Admin must approve
     * (activate) it via the existing Users management screen before it can
     * log in, the same gate `login()` already enforces for any deactivated
     * account.
     *
     * Barangays are independent tenants (see BelongsToBarangay/
     * ScopedThroughVehicle) — every barangay gets its own bootstrap, not
     * just the very first account system-wide:
     * - The first account to register under a GIVEN barangay becomes that
     *   barangay's Admin immediately, active, no approval needed — there's
     *   nobody else there yet who could review them. This can happen once
     *   per barangay, whenever it happens to get its first registrant.
     * - Everyone else registering under a barangay that already has
     *   someone must supply THAT barangay's own Staff Registration Code —
     *   the actual gate against a stranger reaching that barangay Admin's
     *   approval queue at all, checked before an account is even created.
     */
    public function register(Request $request)
    {
        $data = $request->validate([
            // Letters, spaces, and the punctuation that legitimately shows up
            // in PH names (hyphenated surnames, "Ñ", apostrophes, "Jr.").
            'name' => ['required', 'string', 'max:255', 'regex:/^[A-Za-zÀ-ÖØ-öø-ÿ.\'\- ]+$/u'],
            'email' => ['required', 'email', 'unique:users,email'],
            'password' => ['required', 'string', 'min:8', 'confirmed'],
            // PH mobile format: 09 + 9 digits = 11 digits total.
            'phone' => ['required', 'regex:/^09[0-9]{9}$/'],
            'address' => ['required', 'string', 'max:255'],
            'city_id' => ['required', 'exists:cities,id'],
            // Only cities with a real barangay list (Mandaue City today) get
            // a dropdown (barangay_id); every other city falls back to free
            // text (barangay_name) — exactly one of the two is required.
            'barangay_id' => [
                'nullable',
                'required_without:barangay_name',
                'exists:barangays,id',
                function ($attribute, $value, $fail) use ($request) {
                    if ($value && (int) Barangay::find($value)?->city_id !== (int) $request->input('city_id')) {
                        $fail('Selected barangay does not belong to the selected city.');
                    }
                },
            ],
            'barangay_name' => ['nullable', 'required_without:barangay_id', 'string', 'max:255'],
        ], [
            'name.regex' => 'Name may only contain letters.',
            'phone.regex' => 'Phone number must be 11 digits starting with 09 (e.g. 09171234567).',
        ]);

        // No barangay picked from a dropdown (the city has no seeded list
        // yet) — turn the free-typed name into a real Barangay row, scoped
        // to this city, so it shows up as an option for the next person
        // registering under the same city instead of staying a one-off
        // string. This also resolves the concrete barangay_id every
        // registrant needs before we can know whose "first" they'd be.
        $barangayId = $data['barangay_id'] ?? null;
        if (!$barangayId && !empty($data['barangay_name'])) {
            $barangayId = Barangay::findOrCreateForCity((int) $data['city_id'], $data['barangay_name'])->id;
        }

        // Deliberately unscoped (User carries no global scope) and looks
        // across every barangay — this is the one place that's supposed to.
        $isFirstForBarangay = !User::where('barangay_id', $barangayId)->exists();

        $roleData = $request->validate([
            // The first-for-this-barangay account has no role choice (it's
            // always Admin) and no code to check — there's nothing to gate yet.
            'requested_role' => [$isFirstForBarangay ? 'nullable' : 'required', Rule::in(['Custodian', 'Maintenance Personnel'])],
            'staff_code' => [$isFirstForBarangay ? 'nullable' : 'required', 'string'],
        ], [
            'requested_role.required' => 'Please select whether you are a Custodian or Maintenance Personnel.',
            'staff_code.required' => 'Please enter the staff registration code given to you by your barangay office.',
        ]);

        if (!$isFirstForBarangay) {
            abort_unless(
                hash_equals(RegistrationSetting::for($barangayId)->staff_code, strtoupper(trim($roleData['staff_code']))),
                422,
                'That staff registration code is not correct. Ask your barangay office for the current code.'
            );
        }

        $role = $isFirstForBarangay ? 'Admin' : $roleData['requested_role'];

        $user = User::create([
            'name' => $data['name'],
            'email' => $data['email'],
            'password' => Hash::make($data['password']),
            'phone' => $data['phone'],
            'address' => $data['address'],
            'city_id' => $data['city_id'],
            'barangay_id' => $barangayId,
            'barangay_name' => $data['barangay_name'] ?? null,
            'role' => $role,
            'roles' => [$role],
            'is_active' => $isFirstForBarangay,
            'approved_at' => $isFirstForBarangay ? now() : null,
        ]);

        return response()->json([
            'message' => $isFirstForBarangay
                ? 'Admin account created for your barangay. You can sign in now.'
                : 'Registration submitted. An administrator must approve your account before you can sign in.',
            'user' => [
                'id' => $user->id,
                'name' => $user->name,
                'email' => $user->email,
            ],
        ], 201);
    }

    /**
     * Public, side-effect-free preview for the Register form: "if I submit
     * with this barangay, will I become its first Admin?" Lets the
     * frontend show that up front instead of only after submitting.
     * Never creates anything — a free-typed barangay that doesn't exist
     * yet is trivially "first" without touching the database.
     */
    public function registrationStatus(Request $request)
    {
        $data = $request->validate([
            'city_id' => ['required', 'exists:cities,id'],
            'barangay_id' => ['nullable', 'exists:barangays,id'],
            'barangay_name' => ['nullable', 'string', 'max:255'],
        ]);

        $barangayId = $data['barangay_id'] ?? null;

        if (!$barangayId && !empty($data['barangay_name'])) {
            $barangayId = Barangay::where('city_id', $data['city_id'])
                ->whereRaw('LOWER(name) = ?', [strtolower(trim($data['barangay_name']))])
                ->value('id');
        }

        $isFirst = !$barangayId || !User::where('barangay_id', $barangayId)->exists();

        return response()->json(['is_first' => $isFirst]);
    }

    /**
     * Handle stateless frontend login requests.
     */
    public function login(Request $request)
    {
        // 1. Validate incoming user inputs from React
        $request->validate([
            'email' => 'required|email',
            'password' => 'required|string',
        ]);

        // 2. Locate the user profile row in the database
        $user = User::where('email', $request->email)->first();

        // 3. Verify the record exists and evaluate the encrypted password match
        if (!$user || !Hash::check($request->password, $user->password)) {
            return response()->json([
                'message' => 'Invalid credentials provided. Please check your email or password.'
            ], 401); // Returns 401 Unauthorized status code
        }

        if (!$user->is_active) {
            return response()->json([
                'message' => 'This account has been deactivated. Contact an administrator.'
            ], 403);
        }

        // 4. Issue a secure, unique Sanctum token, tagged with every role
        //    (hat) the account may wear so token abilities match its access.
        $token = $user->createToken('auth_token', $user->allRoles())->plainTextToken;

        // 5. Send data bundle back to the React client application
        return response()->json([
            'message' => 'Login authenticated successfully!',
            'access_token' => $token,
            'token_type' => 'Bearer',
            'user' => [
                'id' => $user->id,
                'name' => $user->name,
                'email' => $user->email,
                'role' => $user->role, // Primary role — drives the portal layout
                'roles' => $user->allRoles(), // Every hat this account may wear
            ]
        ], 200);
    }

    /**
     * DEV-ONLY for an Admin: returns 404 outside local/testing, so an
     * ordinary barangay Admin's shortcut never exists in a deployed app.
     * A Super Admin is exempt — production impersonation, for real account
     * support/recovery, is exactly what that role is for; every use is
     * still logged (see impersonate() below).
     */
    private function assertImpersonationEnabled(Request $request): void
    {
        if ($request->user()?->hasRole('Super Admin')) {
            return;
        }
        abort_unless(app()->environment(['local', 'testing']), 404);
    }

    /**
     * True for the real Admin/Super Admin who kicked off impersonation, AND
     * for every account they've since jumped into — the 'impersonated'
     * ability travels with the token so switching accounts (or back to
     * yourself) mid-session doesn't require logging out. A genuine
     * Custodian's normal login token never carries this ability, since it's
     * only ever added by impersonate() below, which itself requires the
     * caller to already pass this same check — a real Custodian has no way
     * to obtain it.
     */
    private function canImpersonate(Request $request): bool
    {
        return $request->user()?->hasRole('Admin')
            || $request->user()?->hasRole('Super Admin')
            || (bool) $request->user()?->currentAccessToken()?->can('impersonated');
    }

    /**
     * List accounts an authenticated user can jump into. For an Admin this
     * is DEV-ONLY (see assertImpersonationEnabled); for a Super Admin it
     * works in production too — that's the real account-recovery path.
     *
     * Deliberately spans every barangay, not just the caller's own — an
     * Admin's use of this is dev-only and never exists in production, so
     * the usual "don't leak other tenants' data" concern doesn't apply to
     * them; a Super Admin is explicitly meant to see across every barangay.
     * The frontend groups the result by province/barangay so the caller can
     * jump to any staff account in any barangay.
     */
    public function impersonationCandidates(Request $request)
    {
        $this->assertImpersonationEnabled($request);
        abort_unless($this->canImpersonate($request), 403, 'Only an Admin or Super Admin can impersonate another account.');

        return User::with('barangay.city.province')
            ->orderBy('name')
            ->get(['id', 'name', 'email', 'role', 'roles', 'is_active', 'barangay_id'])
            ->map(fn ($u) => [
                'id' => $u->id,
                'name' => $u->name,
                'email' => $u->email,
                'role' => $u->role,
                'roles' => $u->roles,
                'is_active' => $u->is_active,
                'barangay_id' => $u->barangay_id,
                'province_id' => $u->barangay?->city?->province?->id,
                'province_name' => $u->barangay?->city?->province?->name,
                'city_name' => $u->barangay?->city?->name,
                'barangay_name' => $u->barangay?->name,
            ]);
    }

    /**
     * Issue a token for another account so the caller can switch roles
     * without logging out and back in. For an Admin: DEV-ONLY, guarded by
     * environment (404 in production), the canImpersonate check, AND, on
     * the client, by import.meta.env.DEV — all three must hold. For a
     * Super Admin: works in production too, for real account support —
     * every use is logged below.
     */
    public function impersonate(Request $request, User $user)
    {
        $this->assertImpersonationEnabled($request);
        abort_unless($this->canImpersonate($request), 403, 'Only an Admin or Super Admin can impersonate another account.');
        // Deliberately allowed to cross barangays — see impersonationCandidates
        // above.
        abort_if(!$user->is_active, 422, 'That account is deactivated.');

        $token = $user->createToken('impersonation_token', [...$user->allRoles(), 'impersonated'])->plainTextToken;

        $actingAsSuperAdmin = $request->user()?->hasRole('Super Admin');
        ActivityLog::create([
            'user_id' => $request->user()?->id,
            'role'    => $request->user()?->role,
            'action'  => 'Impersonate',
            'module'  => $actingAsSuperAdmin ? 'Super Admin' : 'Dev Tools',
            'details' => ($request->user()?->name ?? 'Someone') . " impersonated {$user->name}"
                . ($actingAsSuperAdmin ? '.' : ' (dev only).'),
        ]);

        return response()->json([
            'access_token' => $token,
            'token_type'   => 'Bearer',
            'user' => [
                'id'    => $user->id,
                'name'  => $user->name,
                'email' => $user->email,
                'role'  => $user->role,
                'roles' => $user->allRoles(),
            ],
        ]);
    }

    /**
     * Terminate active sessions and revoke active tokens.
     */
    public function logout(Request $request)
    {
        // Revoke the exact token string utilized to authenticate the active API request
        $request->user()->currentAccessToken()->delete();

        return response()->json([
            'message' => 'Session terminated and token revoked successfully.'
        ], 200);
    }

    /**
     * Return a time-aware greeting for the authenticated workspace user.
     */
    public function greeting(Request $request)
    {
        $user = $request->user();
        $timezone = 'Asia/Manila';
        $now = now($timezone);
        $hour = (int) $now->format('G');
        $displayName = strtoupper(strtok(trim($user->name), ' ') ?: $user->name);

        $period = match (true) {
            $hour >= 5 && $hour < 12 => 'morning',
            $hour === 12 => 'noon',
            $hour >= 13 && $hour < 15 => 'afternoon',
            $hour >= 15 && $hour < 18 => 'late_afternoon',
            $hour >= 18 && $hour < 22 => 'evening',
            default => 'night',
        };

        $messages = [
            'morning' => [
                "Rise and shine, {$displayName}!",
                "A bright morning to you, {$displayName}!",
                "Fresh start, {$displayName}! Let's keep the fleet moving.",
                "Morning momentum is here, {$displayName}!",
            ],
            'noon' => [
                "Happy noon, {$displayName}!",
                "Midday check-in, {$displayName}! The fleet is ready.",
                "It's noon, {$displayName}! Keep the day rolling.",
                "A steady noon to you, {$displayName}!",
            ],
            'afternoon' => [
                "A pleasant afternoon, {$displayName}!",
                "Good energy this afternoon, {$displayName}!",
                "Afternoon focus is on, {$displayName}!",
                "Keep the dashboard sharp this afternoon, {$displayName}!",
            ],
            'late_afternoon' => [
                "It's late afternoon, {$displayName}!",
                "Late afternoon focus, {$displayName}!",
                "A strong late afternoon to you, {$displayName}!",
                "The day is still moving, {$displayName}!",
            ],
            'evening' => [
                "A calm evening to you, {$displayName}!",
                "Evening check-in, {$displayName}! The fleet is in view.",
                "Good evening, {$displayName}! Keep things steady.",
                "The evening shift is looking sharp, {$displayName}!",
            ],
            'night' => [
                "Working late, {$displayName}? The dashboard is ready.",
                "Quiet night watch, {$displayName}!",
                "Late-night focus, {$displayName}!",
                "The fleet rests easier with you here, {$displayName}!",
            ],
        ];

        $roleLabel = match ($user->role) {
            'Admin' => 'Administrator',
            'Maintenance Personnel' => 'Maintenance',
            default => $user->role,
        };

        $periodMessages = $messages[$period];
        $greeting = $periodMessages[random_int(0, count($periodMessages) - 1)];

        return response()->json([
            'greeting' => $greeting,
            'period' => $period,
            'role_label' => $roleLabel,
            'timezone' => $timezone,
            'generated_at' => $now->toIso8601String(),
            'user' => [
                'id' => $user->id,
                'name' => $user->name,
                'email' => $user->email,
                'role' => $user->role,
            ],
        ]);
    }

    /**
     * Update the authenticated user's security password.
     */
    public function updatePassword(Request $request)
    {
        $data = $request->validate([
            'old_password' => ['required', 'string'],
            'new_password' => ['required', 'string', 'min:8', 'confirmed'],
        ]);

        if (! Hash::check($data['old_password'], $request->user()->password)) {
            return response()->json([
                'message' => 'The old password you entered is incorrect.',
            ], 422);
        }

        $request->user()->update([
            'password' => Hash::make($data['new_password']),
        ]);

        ActivityLog::create([
            'user_id' => $request->user()->id,
            'role' => $request->user()->role,
            'action' => 'Edit',
            'module' => 'Profile',
            'affected_record_id' => (string) $request->user()->id,
            'details' => "{$request->user()->name} updated account security credentials.",
        ]);

        return response()->json([
            'message' => 'Password updated successfully.',
        ]);
    }
}
