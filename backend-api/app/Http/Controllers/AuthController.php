<?php

namespace App\Http\Controllers;

use Illuminate\Http\Request;
use App\Models\ActivityLog;
use App\Models\User;
use Illuminate\Support\Facades\Hash;

class AuthController extends Controller
{
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

        // 4. Issue a secure, unique Sanctum token string and tag it with the user's system role
        $token = $user->createToken('auth_token', [$user->role])->plainTextToken;

        // 5. Send data bundle back to the React client application
        return response()->json([
            'message' => 'Login authenticated successfully!',
            'access_token' => $token,
            'token_type' => 'Bearer',
            'user' => [
                'id' => $user->id,
                'name' => $user->name,
                'email' => $user->email,
                'role' => $user->role // Shared so React can trigger the correct portal layout views
            ]
        ], 200);
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
