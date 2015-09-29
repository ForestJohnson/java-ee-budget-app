package com.ilmservice.repository;

import com.ilmservice.repository.IDbManager.IDbIndex;

public interface IDbRequestScope {
	IDbIndex index(short indexId);
}
