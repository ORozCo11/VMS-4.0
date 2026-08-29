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
     * Two exceptions to that, decided after we mapped out the actual risk
     * of "who can become Admin":
     * - The very first account ever created becomes Admin immediately,
     *   active, no approval needed — there's nobody else yet who could
     *   review them. Every registration after that goes through the
     *   normal pending path below; this rule only ever fires once per
     *   installation, the moment the very first person registers.
     * - Everyone else must supply the Staff Registration Code the barangay
     *   office hands directly to real staff — this is the actual gate
     *   against a stranger who isn't barangay staff reaching Admin's
     *   approval queue at all, checked before an account is even created.
     */
    public function register(Request $request)
    {
        $isFirstAccount = !User::query()->exists();

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
            // The first account has no role choice (it's always Admin) and
            // no code to check — there's nothing to gate yet.
            'requested_role' => [$isFirstAccount ? 'nullable' : 'required', Rule::in(['Custodian', 'Maintenance Personnel'])],
            'staff_code' => [$isFirstAccount ? 'nullable' : 'required', 'string'],
        ], [
            'name.regex' => 'Name may only contain letters.',
            'phone.regex' => 'Phone number must be 11 digits starting with 09 (e.g. 09171234567).',
            'requested_role.required' => 'Please select whether you are a Custodian or Maintenance Personnel.',
            'staff_code.required' => 'Please enter the staff registration code given to you by your barangay office.',
        ]);

        if (!$isFirstAccount) {
            abort_unless(
                hash_equals(RegistrationSetting::current()->staff_code, strtoupper(trim($data['staff_code']))),
                422,
                'That staff registration code is not correct. Ask your barangay office for the current code.'
            );
        }

        $role = $isFirstAccount ? 'Admin' : $data['requested_role'];

        // No barangay picked from a dropdown (the city has no seeded list
        // yet) — turn the free-typed name into a real Barangay row, scoped
        // to this city, so it shows up as an option for the next person
        // registering under the same city instead of staying a one-off string.
        $barangayId = $data['barangay_id'] ?? null;
        if (!$barangayId && !empty($data['barangay_name'])) {
            $barangayId = Barangay::findOrCreateForCity((int) $data['city_id'], $data['barangay_name'])->id;
        }

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
            'is_active' => $isFirstAccount,
            'approved_at' => $isFirstAccount ? now() : null,
        ]);

        return response()->json([
            'message' => $isFirstAccount
                ? 'Admin account created. You can sign in now.'
                : 'Registration submitted. An administrator must approve your account before you can sign in.',
            'user' => [
                'id' => $user->id,
                'name' => $user->name,
                'email' => $user->email,
            ],
        ], 201);
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
     * DEV-ONLY. Returns 404 outside local/testing, so it does not exist in a
     * deployed app and can never become a privilege-escalation hole.
     */
    private function assertImpersonationEnabled(): void
    {
        abort_unless(app()->environment(['local', 'testing']), 404);
    }

    /**
     * True for the real Admin who kicked off impersonation, AND for every
     * account they've since jumped into — the 'impersonated' ability travels
     * with the token so switching accounts (or back to yourself) mid-session
     * doesn't require logging out. A genuine Custodian's normal login token
     * never carries this ability, since it's only ever added by
     * impersonate() below, which itself requires the caller to already pass
     * this same check — a real Custodian has no way to obtain it.
     */
    private function canImpersonate(Request $request): bool
    {
        return $request->user()?->hasRole('Admin')
            || (bool) $request->user()?->currentAccessToken()?->can('impersonated');
    }

    /**
     * DEV-ONLY: list accounts an authenticated user can jump into for testing.
     * Admin-only (or an active impersonation session — see canImpersonate) —
     * the environment gate alone only stops this in production; within
     * local/testing it previously let ANY authenticated account (not just
     * Admin) enumerate and impersonate any other, including an Admin.
     */
    public function impersonationCandidates(Request $request)
    {
        $this->assertImpersonationEnabled();
        abort_unless($this->canImpersonate($request), 403, 'Only an Admin can impersonate another account.');

        return User::orderBy('name')->get(['id', 'name', 'email', 'role', 'roles', 'is_active']);
    }

    /**
     * DEV-ONLY: issue a token for another account so a developer can switch
     * roles without logging out and back in. Guarded by environment (404 in
     * production), the canImpersonate check, AND, on the client, by
     * import.meta.env.DEV — all three must hold.
     */
    public function impersonate(Request $request, User $user)
    {
        $this->assertImpersonationEnabled();
        abort_unless($this->canImpersonate($request), 403, 'Only an Admin can impersonate another account.');
        abort_if(!$user->is_active, 422, 'That account is deactivated.');

        $token = $user->createToken('impersonation_token', [...$user->allRoles(), 'impersonated'])->plainTextToken;

        ActivityLog::create([
            'user_id' => $request->user()?->id,
            'role'    => $request->user()?->role,
            'action'  => 'Impersonate',
            'module'  => 'Dev Tools',
            'details' => ($request->user()?->name ?? 'A developer') . " impersonated {$user->name} (dev only).",
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
