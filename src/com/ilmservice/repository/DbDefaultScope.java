package com.ilmservice.repository;

import java.io.IOException;

import javax.annotation.PostConstruct;
import javax.annotation.PreDestroy;
import javax.enterprise.context.RequestScoped;
import javax.enterprise.inject.Default;
import javax.inject.Inject;
import javax.inject.Singleton;

import com.ilmservice.repository.IDbManager.IDbIndex;
import com.ilmservice.repository.IDbManager.IDbTransaction;

@Default
@Singleton
@NoTransaction
public class DbDefaultScope implements IDbScope {
	@Inject private IDbManager db;
	
	public IDbIndex index(short indexId) {
		return db.index(indexId);
	}
	
}
