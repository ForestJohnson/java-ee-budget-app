package com.ilmservice.repository;

import java.io.IOException;

import javax.annotation.PostConstruct;
import javax.annotation.PreDestroy;
import javax.enterprise.context.RequestScoped;
import javax.inject.Inject;

import com.ilmservice.repository.IDbManager.IDbTransaction;

@RequestScoped
public class DbRequestScope implements IDbRequestScope {
	@Inject private IDbManager db;
	
	private IDbTransaction transaction;
	
	@PostConstruct 
	private void beginTransaction () {
		transaction = db.openTransaction();
	}
	
	@PreDestroy
	public void endTransaction() throws IOException {
		transaction.execute();
	}
}
