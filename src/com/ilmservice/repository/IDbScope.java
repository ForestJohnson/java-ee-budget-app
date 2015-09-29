package com.ilmservice.repository;

import com.ilmservice.repository.IDbManager.IDbIndex;

public interface IDbScope {
	IDbIndex index(short indexId);
}
