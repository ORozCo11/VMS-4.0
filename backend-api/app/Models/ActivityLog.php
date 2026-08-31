<?php

namespace App\Models;

use App\Models\Concerns\BelongsToBarangay;
use Illuminate\Database\Eloquent\Model;

class ActivityLog extends Model
{
    use BelongsToBarangay;

    protected $primaryKey = 'log_id';

    protected $fillable = [
        'user_id',
        'role',
        'action',
        'module',
        'affected_record_id',
        'details',
        'barangay_id',
    ];

    public function user()
    {
        return $this->belongsTo(User::class);
    }
}
