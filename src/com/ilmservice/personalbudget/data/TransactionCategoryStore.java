package com.ilmservice.personalbudget.data;

import java.io.IOException;
import java.nio.ByteBuffer;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.ArrayList;
import java.util.Date;
import java.util.List;
import java.util.Optional;

import javax.annotation.PostConstruct;
import javax.ejb.Stateless;
import javax.enterprise.context.RequestScoped;
import javax.enterprise.inject.Default;
import javax.inject.Inject;
import javax.inject.Singleton;

import com.google.protobuf.ByteString;
import com.ilmservice.personalbudget.protobufs.Data.Transaction;
import com.ilmservice.personalbudget.protobufs.Data.TransactionCategory;
import com.ilmservice.personalbudget.protobufs.Views.DateRangeFilter;
import com.ilmservice.personalbudget.protobufs.Views.Filter;
import com.ilmservice.personalbudget.protobufs.Views.TransactionList;
import com.ilmservice.personalbudget.protobufs.Views.UnsortedTransaction;
import com.ilmservice.repository.IDbScope;
import com.ilmservice.repository.IRepository;
import com.ilmservice.repository.IRepository.IRepositoryIndex;
import com.ilmservice.repository.IRepository.IRepositoryQuery;
import com.ilmservice.repository.TransactionPerRequest;

@Default
@Singleton
public class TransactionCategoryStore implements ITransactionCategoryStore {
	
	@Inject 
	@TransactionPerRequest
	private IDbScope scope;
	
	@Inject 
	private IRepository<TransactionCategory> categories;
	
	private IRepositoryIndex<Integer, TransactionCategory> categoriesById;
	
	@PostConstruct
	public void configure() {
		System.out.println("TransactionCategoryStore configuring");
		categories.configure( 
			scope,
			(bytes) -> TransactionCategory.parseFrom(bytes),
			(transaction) -> transaction.toByteArray(),
			() -> {
				try {
					System.out.println("TransactionCategoryStore indexes ");

					categoriesById = categories.configureIndex(
						Indexes.TransactionCategoriesById.getValue(),
						false,
						(k) -> TransactionCategory.getDefaultInstance(),
						(v) -> v.getId(),
						(k) -> ByteBuffer.allocate(4).putInt(k).array()
					);
				} catch (Exception e) {
					e.printStackTrace();
				}
			}
		);
					
	}
	
	@Override
	public TransactionCategory put(TransactionCategory.Builder builder) throws IOException, Exception {
		TransactionCategory highest;
		try {
			highest = categoriesById.query().descending().firstOrDefault();
		} catch (IOException e) {
			highest = TransactionCategory.getDefaultInstance();
			e.printStackTrace();
		}
		System.out.println("highest: "+ highest);
		
		builder.setId(highest.getId()+1);
		
		System.out.println("builder: "+ builder);
		return categories.put(builder.build());
	}
	
	@Override
	public TransactionCategory get (int id ) {
		try {
			return categoriesById.query().atKey(id).firstOrDefault();
		} catch (IOException e) {
			e.printStackTrace();
		}
		return TransactionCategory.getDefaultInstance();
	}
	
	@Override
	public List<TransactionCategory> getAll() {
		return categoriesById.query().toArray();
	}
}
