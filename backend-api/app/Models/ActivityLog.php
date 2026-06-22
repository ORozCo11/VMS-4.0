<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class ActivityLog extends Model
{
    protected $primaryKey = 'log_id';

    protected $fillable = [
        'user_id',
        'role',
        'action',
        'module',
        'affected_record_id',
        'details',
    ];

    public function user()
    {
        return $this->belongsTo(User::class);
    }
}
