package com.ilmservice.repository;

import java.io.IOException;

import javax.annotation.PostConstruct;
import javax.annotation.PreDestroy;
import javax.enterprise.context.RequestScoped;
import javax.inject.Inject;

import com.ilmservice.repository.IDbManager.IDbIndex;
import com.ilmservice.repository.IDbManager.IDbTransaction;

@RequestScoped
public class DbRequestScope implements IDbRequestScope {
	@Inject private IDbManager db;
	
	private IDbTransaction transaction;
	
	@PostConstruct 
	private void beginTransaction () {
		transaction = db.openTransaction();
		System.out.println("beginTransaction");
	}
	
	public IDbIndex index(short indexId) {
		System.out.println("Transaction::index");
		return transaction.index(indexId);
	}
	
	@PreDestroy
	public void endTransaction() {
		System.out.println("endTransaction");
		try {
			transaction.execute();
		} catch (IOException e) {
			System.out.println("transaction failed and was never closed ??");
			e.printStackTrace();
		}
	}
}
